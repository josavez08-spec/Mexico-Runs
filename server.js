const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const path = require('node:path');
const fs = require('node:fs');
require('dotenv').config();

const app = express();
const scrypt = promisify(crypto.scrypt);
const sessions = new Map();
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  ...(process.env.DB_PORT ? { port: Number(process.env.DB_PORT) } : {}),
  options: { encrypt: false, trustServerCertificate: true, ...(!process.env.DB_PORT && process.env.DB_INSTANCE ? { instanceName: process.env.DB_INSTANCE } : {}) },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
};
let poolPromise;
function db() {
  if (!poolPromise) poolPromise = sql.connect(dbConfig).catch(error => { poolPromise = null; throw error; });
  return poolPromise;
}
db().then(async () => { await applyStartupMigration(); console.log('✅ Conectado a ' + process.env.DB_DATABASE + ' · mejoras aplicadas/verificadas'); }).catch(e => console.error('❌ SQL Server / migración:', e.message));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '30kb' }));
app.get('/basededatos.html',(req,res,next)=>{
  const user=sessions.get(cookieToken(req));
  if(!user)return res.redirect('/login.html');
  if(user.role!=='Administrador')return res.status(403).send('Acceso exclusivo para cuentas Administrador.');
  next();
});app.use(express.static(__dirname));

const aliases = {
  accountId: ['id', 'cuentaid', 'idcuenta', 'clienteid', 'idcliente'],
  roleId: ['id_rol', 'rolid', 'idrol', 'id'], roleName: ['nombre_rol', 'nombrerol', 'rol'],
  name: ['nombre', 'nombres'], surname: ['apellido_pat', 'apellidopaterno', 'apellido_paterno'],
  surname2: ['apellido_mat', 'apellidomaterno', 'apellido_materno'], email: ['correo', 'email'],
  password: ['contrasena', 'password', 'hashcontrasena'], phone: ['telefono', 'celular'], license: ['numero_licencia', 'licencia'],
  vehicleId: ['id_vehiculo', 'vehiculoid', 'idvehiculo', 'id'], vehicleName: ['nombre', 'modelo', 'vehiculo'],
  brand: ['marca'], category: ['categoria', 'tipo', 'categoriaid', 'id_categoria', 'idcategoria'],
  price: ['precio_diario', 'preciodiario', 'precio', 'tarifa', 'tarifa_diaria', 'costo_dia', 'costodia', 'precio_renta', 'preciodiarioneto'],
  image: ['imagen', 'foto', 'url_imagen', 'urlimagen'], description: ['descripcion', 'detalles'],
  status: ['estado', 'estatus', 'estado_vehiculo', 'id_estado', 'estadoid', 'estado_vehiculo_id', 'id_estado_vehiculo'], transmission: ['transmision'], seats: ['pasajeros', 'asientos'], year: ['anio', 'ano', 'year'], color: ['color'], mileage: ['kilometraje', 'km'], plates: ['placas', 'matricula'],
  reservationId: ['id_reservacion', 'reservacionid', 'idreservacion', 'id'], clientId: ['id_cliente', 'clienteid', 'idcliente', 'id_cuenta', 'id_cuenta_cliente', 'cuentaid'],
  start: ['fecha_inicio', 'fechainicio', 'fecha_recogida', 'fecharecogida'], end: ['fecha_fin', 'fechafin', 'fecha_devolucion', 'fechadevolucion'],
  total: ['total', 'monto_total', 'montototal', 'importe', 'costo_total', 'costototal'],
  pickupBranch: ['sucursal_recogida', 'id_sucursal_recogida', 'sucursalentrega', 'sucursal_entrega', 'sucursalentregaid', 'idsucursalentrega', 'sucursalid'],
  dropoffBranch: ['sucursal_devolucion', 'sucursaldevolucion', 'sucursaldevolucionid', 'idsucursaldevolucion','id_sucursal_entrega'],
  reservationStatus: ['id_estado_reservacion', 'estadoreservacionid', 'idestadoreservacion', 'estado_reservacion_id'],
  passwordReset: ['debe_cambiar_contrasena','debecambiarcontrasena','forzar_cambio_clave'],
};
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const qid = s => '[' + String(s).replace(/]/g, ']]') + ']';
async function columns(table) {
  const pool = await db();
  const r = await pool.request().input('table', sql.NVarChar(128), table)
    .query('SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, CHARACTER_MAXIMUM_LENGTH, ORDINAL_POSITION FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = N\'dbo\' AND TABLE_NAME=@table ORDER BY ORDINAL_POSITION');
  if (!r.recordset.length) throw Object.assign(new Error('No se encontró la tabla dbo.' + table + ' en ' + process.env.DB_DATABASE), { status: 503 });
  return r.recordset;
}
function col(cols, semantic) {
  const names = (aliases[semantic] || []).map(norm);
  for (const name of names) {
    const match = cols.find(c => norm(c.COLUMN_NAME) === name);
    if (match) return match;
  }
  return undefined;
}
function reqCol(cols, semantic, label) {
  const c = col(cols, semantic);
  if (!c) throw Object.assign(new Error('No pude reconocer la columna de ' + label + ' en la tabla. Revisa el esquema de SQL Server.'), { status: 400 });
  return c;
}
async function catalogId(table,label){try{const c=await columns(table),id=col(c,'roleId')||c.find(x=>/^id/i.test(x.COLUMN_NAME)),n=col(c,'roleName')||c.find(x=>/nombre|estado/i.test(x.COLUMN_NAME));if(!id||!n)return null;const r=await(await db()).request().input('label',sql.NVarChar(80),label).query('SELECT TOP 1 '+qid(id.COLUMN_NAME)+' AS id FROM dbo.'+qid(table)+' WHERE LOWER('+qid(n.COLUMN_NAME)+')=LOWER(@label)');return r.recordset[0]?.id??null}catch{return null}}
function typedValue(c,v){if(v==null||typeof v!=='string')return v;if(/^(int|bigint|smallint|tinyint|decimal|numeric|money|smallmoney|float|real|bit)$/.test(c.DATA_TYPE)){const n=Number(v);if(!Number.isFinite(n))throw Object.assign(new Error('El campo '+c.COLUMN_NAME+' debe ser numérico.'),{status:400});return n}return v}
function cookieToken(req) { const m = (req.headers.cookie || '').match(/(?:^|;\s*)mr_session=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; }
function auth(req, res, next) {
  const entry = sessions.get(cookieToken(req));
  if (!entry) return res.status(401).json({ success: false, message: 'Inicia sesión para continuar.' });
  if (entry.mustChange && req.path !== '/api/cambiar-contrasena') return res.status(403).json({success:false,message:'Actualiza tu contraseña para continuar.',mustChange:true});
  req.user = entry; next();
}
function admin(req, res, next) {
  if (req.user.role !== 'Administrador') return res.status(403).json({ success: false, message: 'Esta función es exclusiva para administradores.' });
  next();
}
async function applyStartupMigration(){
  const file=path.join(__dirname,'database','MejorasMexicoRuns.sql');
  const pool=await db();
  const batches=fs.readFileSync(file,'utf8').split(/^\s*GO\s*$/im).filter(x=>x.trim());
  for(const batch of batches) await pool.request().batch(batch);
}
function recordError(e){
  console.error(e);
  db().then(pool=>pool.request()
    .input('procedimiento',sql.NVarChar(128),e.procedure||null)
    .input('numero_error',sql.Int,e.number||null)
    .input('severidad',sql.Int,e.class||null)
    .input('estado',sql.Int,e.state||null)
    .input('linea',sql.Int,e.lineNumber||null)
    .input('mensaje',sql.NVarChar(sql.MAX),String(e.message||e))
    .execute('dbo.sp_RegistrarError'))
    .catch(x=>console.error('Bitácora no disponible:',x.message));
}
async function audit(user,action,table,id,details){
  try{const safe=JSON.parse(JSON.stringify(details||{}),(key,value)=>/password|contrasena|clave/i.test(key)?'[REDACTADO]':value);await(await db()).request().input('id_usuario',sql.Int,user.id).input('rol',sql.NVarChar(50),user.role).input('accion',sql.NVarChar(50),action).input('tabla',sql.NVarChar(128),table).input('id_registro',sql.NVarChar(100),String(id)).input('detalle',sql.NVarChar(sql.MAX),JSON.stringify(safe)).query('INSERT dbo.BitacoraAuditoria(id_usuario,rol,accion,tabla,id_registro,detalle) VALUES(@id_usuario,@rol,@accion,@tabla,@id_registro,@detalle)')}catch(e){console.error('Auditoría no disponible:',e.message)}
}
function explainSqlError(number,message=''){
  const raw=String(message||'');
  if(Number(number)===547 && /DELETE statement conflicted/i.test(raw)) return 'No se puede borrar porque existen registros vinculados (por ejemplo, reservaciones, pagos, opiniones o mantenimientos). Conserva el historial o retira el elemento de la flota.';
  if(Number(number)===547) return 'No se pudo guardar: alguno de los IDs relacionados no existe o está protegido por una relación de la base de datos.';
  if(Number(number)===2627||Number(number)===2601) return 'Ya existe un registro con ese dato único. Revisa el correo, las placas o el número de serie.';
  if(Number(number)===208) return 'Falta una tabla o una migración de la base de datos. Reinicia el servidor para aplicar las mejoras.';
  return raw;
}function fail(res, e) {
  recordError(e);
  const status = e.status || (e.number === 2627 || e.number === 2601 ? 409 : 500);
  const message = explainSqlError(e.number,e.message) || (status === 409 ? 'Ese dato ya existe (por ejemplo, correo, placas o serie).' : status < 500 ? e.message : 'No se pudo completar la operación en SQL Server. Revisa tablas, relaciones y conexión.');
  return res.status(status).json({ success: false, message });
}
async function accountByEmail(email) {
  const cols = await columns('CuentasCliente');
  const id=reqCol(cols,'accountId','id de cuenta'), mail=reqCol(cols,'email','correo'), pass=reqCol(cols,'password','contraseña'), role=reqCol(cols,'roleId','rol');
  const roleCols=await columns('Roles'), rolePk=reqCol(roleCols,'roleId','id de rol'), roleLabel=reqCol(roleCols,'roleName','nombre de rol');
  const pool=await db();
  const result=await pool.request().input('email',sql.NVarChar(160),email.trim().toLowerCase()).query(`SELECT c.*, r.${qid(roleLabel.COLUMN_NAME)} AS __role FROM dbo.CuentasCliente c INNER JOIN dbo.Roles r ON c.${qid(role.COLUMN_NAME)}=r.${qid(rolePk.COLUMN_NAME)} WHERE LOWER(c.${qid(mail.COLUMN_NAME)})=@email`);
  return { row: result.recordset[0], cols, id, mail, pass, role };
}
async function checkPassword(candidate, stored) {
  if (typeof stored !== 'string') return false;
  const parts=stored.split('$');
  if (parts.length===3 && parts[0]==='scrypt') {
    const actual=await scrypt(candidate,parts[1],Buffer.from(parts[2],'hex').length);
    const expected=Buffer.from(parts[2],'hex');
    return actual.length===expected.length && crypto.timingSafeEqual(actual,expected);
  }
  // Migración paulatina: acepta cuentas antiguas de la demo y las convierte a hash al iniciar sesión.
  return candidate===stored;
}
async function hashPassword(password) { const salt=crypto.randomBytes(16).toString('hex'); const key=await scrypt(password,salt,64); return 'scrypt$'+salt+'$'+key.toString('hex'); }
function publicUser(row, cols) {
  const v = semantic => { const c=col(cols,semantic); return c ? row[c.COLUMN_NAME] : null; };
  return { id:v('accountId'), nombre:v('name'), apellido_paterno:v('surname'), apellido_materno:v('surname2'), correo:v('email'), telefono:v('phone'), licencia:v('license'), rol:row.__role || null };
}
function newSession(res, user) {
  const token=crypto.randomBytes(32).toString('hex');
  sessions.set(token,user);
  res.setHeader('Set-Cookie',`mr_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${process.env.NODE_ENV==='production'?'; Secure':''}`);
}
function passwordIsStrong(password) {
  return typeof password === 'string' && password.length >= 8 &&
    /[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(password) && /\d/.test(password) &&
    /[^A-Za-z0-9ÁÉÍÓÚáéíóúÑñ]/.test(password);
}

app.get('/api/sesion', (req,res) => { const user=sessions.get(cookieToken(req)); res.json({ authenticated:!!user, user:user||null }); });
app.post('/api/login', async (req,res) => {
  try {
    const { correo, password, rol }=req.body||{};
    if (typeof correo!=='string'||typeof password!=='string') return res.status(400).json({success:false,message:'Escribe correo y contraseña.'});
    const account=await accountByEmail(correo);
    if(account.row?.bloqueada)return res.status(403).json({success:false,message:'La cuenta está bloqueada. Contacta al administrador.'});
    if (!account.row || !(await checkPassword(password,account.row[account.pass.COLUMN_NAME]))) return res.status(401).json({success:false,message:'Correo, contraseña o tipo de cuenta incorrectos.'});
    if (typeof rol==='string' && rol.trim() && rol.trim()!==String(account.row.__role||'')) return res.status(401).json({success:false,message:'Correo, contraseña o tipo de cuenta incorrectos.'});
    if (!String(account.row.__role||'').toLowerCase().includes('admin') && account.row[account.role.COLUMN_NAME]==null) return res.status(403).json({success:false,message:'La cuenta no tiene un rol asignado.'});
    if (!String(account.row[account.pass.COLUMN_NAME]).startsWith('scrypt$')) {
      const h=await hashPassword(password); const p=await db();
      await p.request().input('id',sql.Int,account.row[account.id.COLUMN_NAME]).input('hash',sql.NVarChar(500),h).query(`UPDATE dbo.CuentasCliente SET ${qid(account.pass.COLUMN_NAME)}=@hash WHERE ${qid(account.id.COLUMN_NAME)}=@id`);
    }
    const user=publicUser(account.row,account.cols);
    const mustChange=Boolean(account.row.debe_cambiar_contrasena);
    newSession(res,{...user,role:user.rol,mustChange});
    res.json({success:true,user:{...user,mustChange}});
  } catch(e) { fail(res,e); }
});
app.post('/api/logout',(req,res)=>{sessions.delete(cookieToken(req));res.setHeader('Set-Cookie','mr_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');res.json({success:true});});

app.post('/api/cambiar-contrasena',auth,async(req,res)=>{
  const password=req.body?.password;
  if(!passwordIsStrong(password))return res.status(400).json({success:false,message:'Usa al menos 8 caracteres, una letra, un número y un carácter especial.'});
  try{const cols=await columns('CuentasCliente'),id=reqCol(cols,'accountId','cuenta'),pass=reqCol(cols,'password','contraseña'),flag=col(cols,'passwordReset');const p=await db(),hash=await hashPassword(password),r=p.request().input('id',sql.Int,req.user.id).input('hash',sql.NVarChar(500),hash);const update=flag?`, ${qid(flag.COLUMN_NAME)}=0`:'';await r.query(`UPDATE dbo.CuentasCliente SET ${qid(pass.COLUMN_NAME)}=@hash${update} WHERE ${qid(id.COLUMN_NAME)}=@id`);const token=cookieToken(req);sessions.set(token,{...req.user,mustChange:false});res.json({success:true,message:'Contraseña actualizada.'});}catch(e){fail(res,e);}
});

app.post('/api/registro', async (req,res)=>{
  const { nombre, apellido_paterno, apellido_materno='', correo, password, telefono, licencia } = req.body || {};
  const required=[nombre,apellido_paterno,correo,password,telefono,licencia];
  if(required.some(v=>typeof v!=='string'||!v.trim()) || typeof apellido_materno!=='string' ||
     !/^\S+@\S+\.\S+$/.test(correo) || !/^\d{10}$/.test(telefono) || !passwordIsStrong(password) ||
     nombre.length>50 || apellido_paterno.length>50 || apellido_materno.length>50 || correo.length>100 || licencia.length>30) {
    return res.status(400).json({success:false,message:'Revisa los datos: correo válido, teléfono de 10 dígitos y contraseña de al menos 8 caracteres.'});
  }
  try {
    const hash=await hashPassword(password);
    const roleId=await catalogId('Roles','Cliente');
    if(roleId==null)return res.status(503).json({success:false,message:'No se encontró el rol Cliente. Ejecuta los scripts iniciales de la base de datos.'});
    const inserted=await(await db()).request()
      .input('nombre',sql.NVarChar(50),nombre.trim())
      .input('apellido_pat',sql.NVarChar(50),apellido_paterno.trim())
      .input('apellido_mat',sql.NVarChar(50),apellido_materno.trim()||null)
      .input('telefono',sql.NVarChar(10),telefono.trim())
      .input('correo',sql.NVarChar(100),correo.trim().toLowerCase())
      .input('contrasena',sql.NVarChar(255),hash)
      .input('numero_licencia',sql.NVarChar(30),licencia.trim())
      .input('id_rol',sql.Int,roleId)
      .output('id_cuenta',sql.Int)
      .execute('dbo.sp_RegistrarCuentaCliente');
    const user={id:inserted.output.id_cuenta,nombre:nombre.trim(),apellido_paterno:apellido_paterno.trim(),apellido_materno:apellido_materno.trim()||null,correo:correo.trim().toLowerCase(),telefono:telefono.trim(),licencia:licencia.trim(),rol:'Cliente'};
    newSession(res,{...user,role:'Cliente',mustChange:false});
    return res.status(201).json({success:true,message:'Cuenta creada. Ya iniciaste sesión.',user});  } catch(error) {
    if(error.number===2627||error.number===2601){
      try{const account=await accountByEmail(correo);if(account.row&&await checkPassword(password,account.row[account.pass.COLUMN_NAME])){const user=publicUser(account.row,account.cols),mustChange=Boolean(account.row.debe_cambiar_contrasena);newSession(res,{...user,role:user.rol,mustChange});return res.status(200).json({success:true,message:'La cuenta ya estaba guardada; iniciamos tu sesión.',user:{...user,mustChange}})}}catch(recoveryError){console.error('No se pudo recuperar sesión tras registro previo:',recoveryError.message)}
      return res.status(409).json({success:false,message:'Ese correo ya tiene cuenta. Inicia sesión con la contraseña que elegiste al registrarte.'});
    }
    console.error('Error al registrar cliente:',error);
    return res.status(500).json({success:false,message:'No se pudo guardar la cuenta: '+String(error.message||'error SQL desconocido')});
  }
});

app.get('/api/catalogos',async(req,res)=>{try{const p=await db();const [branches,categories,paymentMethods]=await Promise.all([p.request().query('SELECT id,nombre,ciudad,estado FROM dbo.Sucursales ORDER BY nombre'),p.request().query('SELECT id,nombre,tarifa_diaria FROM dbo.CategoriasVehiculo ORDER BY tarifa_diaria'),p.request().query('SELECT id,nombre FROM dbo.MetodosPago ORDER BY id')]);res.json({sucursales:branches.recordset,categorias:categories.recordset,metodosPago:paymentMethods.recordset});}catch(e){fail(res,e);}});
app.get('/api/flota/resumen',async(req,res)=>{try{const r=await(await db()).request().query("SELECT SUM(CASE WHEN ev.nombre=N'Disponible' THEN 1 ELSE 0 END) AS disponibles,SUM(CASE WHEN ev.nombre=N'En mantenimiento' THEN 1 ELSE 0 END) AS enMantenimiento FROM dbo.Vehiculos v JOIN dbo.EstadosVehiculo ev ON ev.id=v.id_estado_vehiculo WHERE ISNULL(v.retirado,0)=0");res.json({disponibles:r.recordset[0].disponibles||0,enMantenimiento:r.recordset[0].enMantenimiento||0});}catch(e){fail(res,e);}});app.get('/api/vehiculos', async (req,res)=>{
  try { const request=(await db()).request(); let where="WHERE ev.nombre=N'Disponible'";
    if(req.query.inicio&&req.query.fin){const a=new Date(req.query.inicio),b=new Date(req.query.fin);if(!Number.isFinite(a.valueOf())||!Number.isFinite(b.valueOf())||b<=a)return res.status(400).json({success:false,message:'Elige fechas válidas.'});a.setHours(10,0,0,0);b.setHours(10,0,0,0);request.input('inicio',sql.DateTime2,a).input('fin',sql.DateTime2,b);where="WHERE ev.nombre IN (N'Disponible',N'Rentado') AND NOT EXISTS (SELECT 1 FROM dbo.Reservaciones r JOIN dbo.EstadosReservacion er ON er.id=r.id_estado_reservacion WHERE r.id_vehiculo=v.id AND er.nombre IN (N'Pendiente',N'Confirmada',N'En curso') AND r.fecha_inicio<@fin AND r.fecha_fin>@inicio)";}
    const result=await request.query(`SELECT v.*,c.nombre AS categoria,c.tarifa_diaria,ev.nombre AS estado_vehiculo,s.nombre AS sucursal,s.ciudad FROM dbo.Vehiculos v LEFT JOIN dbo.CategoriasVehiculo c ON c.id=v.id_categoria JOIN dbo.EstadosVehiculo ev ON ev.id=v.id_estado_vehiculo LEFT JOIN dbo.Sucursales s ON s.id=v.id_sucursal ${where} AND ISNULL(v.retirado,0)=0 ORDER BY c.tarifa_diaria,v.marca,v.modelo`);res.json(result.recordset); } catch(e){ fail(res,e); }
});
app.get('/api/admin/vehiculos',auth,admin,async(req,res)=>{try{const p=await db();const r=await p.request().query('SELECT v.*,c.nombre AS categoria,c.tarifa_diaria,ev.nombre AS estado_vehiculo,s.nombre AS sucursal,s.ciudad FROM dbo.Vehiculos v LEFT JOIN dbo.CategoriasVehiculo c ON c.id=v.id_categoria LEFT JOIN dbo.EstadosVehiculo ev ON ev.id=v.id_estado_vehiculo LEFT JOIN dbo.Sucursales s ON s.id=v.id_sucursal WHERE ISNULL(v.retirado,0)=0 ORDER BY v.id DESC');res.json(r.recordset);}catch(e){fail(res,e);}});
app.post('/api/admin/vehiculos',auth,admin,async(req,res)=>{
  try { const cols=await columns('Vehiculos'), data=req.body||{}, map=[['vehicleName','nombre'],['brand','marca'],['category','categoria'],['description','descripcion'],['price','precio'],['image','imagen'],['status','estado'],['transmission','transmision'],['seats','pasajeros'],['year','anio'],['color','color'],['mileage','kilometraje'],['plates','placas']];
    const chosen=map.map(([s,k])=>({c:col(cols,s),v:data[k]})).filter(x=>x.c&&x.v!==undefined&&x.v!=='');
    if(!chosen.length) return res.status(400).json({success:false,message:'No llegaron campos reconocidos del vehículo.'});
    const r=await (await db()).request(); chosen.forEach((x,i)=>r.input('v'+i,typedValue(x.c,x.v)));
    const names=chosen.map(x=>qid(x.c.COLUMN_NAME)).join(','); const params=chosen.map((_,i)=>'@v'+i).join(',');
    await r.query(`INSERT INTO dbo.Vehiculos (${names}) VALUES (${params})`);await audit(req.user,'Crear vehículo','Vehiculos',null,data);res.status(201).json({success:true,message:'Vehículo creado.'});
  }catch(e){fail(res,e);}
});
app.put('/api/admin/vehiculos/:id',auth,admin,async(req,res)=>{
  try { const cols=await columns('Vehiculos'), id=reqCol(cols,'vehicleId','id de vehículo'), data=req.body||{}, map=[['vehicleName','nombre'],['brand','marca'],['category','categoria'],['description','descripcion'],['price','precio'],['image','imagen'],['status','estado'],['transmission','transmision'],['seats','pasajeros'],['year','anio'],['color','color'],['mileage','kilometraje'],['plates','placas']];
    const chosen=map.map(([s,k])=>({c:col(cols,s),v:data[k]})).filter(x=>x.c&&x.v!==undefined&&x.v!==''); if(!chosen.length)return res.status(400).json({success:false,message:'No hay campos reconocidos para actualizar.'});
    const r=(await db()).request().input('id',sql.Int,Number(req.params.id));chosen.forEach((x,i)=>r.input('v'+i,typedValue(x.c,x.v)));const set=chosen.map((x,i)=>`${qid(x.c.COLUMN_NAME)}=@v${i}`).join(',');const out=await r.query(`UPDATE dbo.Vehiculos SET ${set} WHERE ${qid(id.COLUMN_NAME)}=@id`);if(!out.rowsAffected[0])return res.status(404).json({success:false,message:'Vehículo no encontrado.'});await audit(req.user,'Actualizar vehículo','Vehiculos',req.params.id,data);res.json({success:true,message:'Vehículo actualizado.'});
  }catch(e){fail(res,e);}
});
app.delete('/api/admin/vehiculos/:id',auth,admin,async(req,res)=>{try{const id=Number(req.params.id);if(!Number.isInteger(id)||id<1)return res.status(400).json({success:false,message:'ID de vehículo no válido.'});const r=await(await db()).request().input('id',sql.Int,id).query('UPDATE dbo.Vehiculos SET retirado=1 WHERE id=@id AND ISNULL(retirado,0)=0');if(!r.rowsAffected[0])return res.status(404).json({success:false,message:'Vehículo no encontrado o ya retirado.'});await audit(req.user,'Retirar vehículo de la flota','Vehiculos',id,{});res.json({success:true,message:'Vehículo eliminado de la flota y del catálogo. Su historial se conservó.'});}catch(e){fail(res,e);}});

app.post('/api/admin/usuarios',auth,admin,async(req,res)=>{
  const d=req.body||{},nombre=String(d.nombre||'').trim(),apellido=String(d.apellido_paterno||'').trim(),correo=String(d.correo||'').trim().toLowerCase(),telefono=String(d.telefono||'').trim(),password=d.password,roleId=Number(d.id_rol);
  if(!nombre||!apellido||nombre.length>50||apellido.length>50||!/^\S+@\S+\.\S+$/.test(correo)||correo.length>100||!/^\d{10}$/.test(telefono)||!passwordIsStrong(password)||!Number.isInteger(roleId))return res.status(400).json({success:false,message:'Revisa nombre, apellido, correo, teléfono y contraseña (8 caracteres, letra, número y símbolo).'});
  try{
    const rc=await columns('Roles'),rid=reqCol(rc,'roleId','id de rol'),rname=reqCol(rc,'roleName','nombre del rol');
    const role=await(await db()).request().input('roleId',sql.Int,roleId).query('SELECT '+qid(rname.COLUMN_NAME)+' AS nombre FROM dbo.Roles WHERE '+qid(rid.COLUMN_NAME)+'=@roleId');
    if(!role.recordset.length||!['administrador','empleado'].includes(String(role.recordset[0].nombre).toLowerCase()))return res.status(400).json({success:false,message:'Selecciona Administrador o Empleado.'});
    const cols=await columns('CuentasCliente'),id=reqCol(cols,'accountId','id de cuenta'),name=reqCol(cols,'name','nombre'),surname=reqCol(cols,'surname','apellido paterno'),mail=reqCol(cols,'email','correo'),phone=reqCol(cols,'phone','teléfono'),pass=reqCol(cols,'password','contraseña'),roleCol=reqCol(cols,'roleId','rol'),license=col(cols,'license'),reset=col(cols,'passwordReset');
    const exists=await(await db()).request().input('email',sql.NVarChar(100),correo).query('SELECT TOP 1 '+qid(id.COLUMN_NAME)+' AS id FROM dbo.CuentasCliente WHERE LOWER('+qid(mail.COLUMN_NAME)+')=@email');
    if(exists.recordset.length)return res.status(409).json({success:false,message:'Ya existe una cuenta con ese correo.'});
    const request=(await db()).request().input('name',sql.NVarChar(50),nombre).input('surname',sql.NVarChar(50),apellido).input('email',sql.NVarChar(100),correo).input('phone',sql.NVarChar(10),telefono).input('password',sql.NVarChar(255),await hashPassword(password)).input('role',sql.Int,roleId);
    const insertCols=[name,surname,mail,phone,pass,roleCol],values=['@name','@surname','@email','@phone','@password','@role'];
    if(license){insertCols.push(license);values.push('@license');request.input('license',sql.NVarChar(30),null)}
    if(reset){insertCols.push(reset);values.push('@reset');request.input('reset',sql.Bit,1)}
    await request.query('INSERT INTO dbo.CuentasCliente ('+insertCols.map(c=>qid(c.COLUMN_NAME)).join(',')+') VALUES ('+values.join(',')+')');
    await audit(req.user,'Crear cuenta de personal','CuentasCliente',correo,{rol:role.recordset[0].nombre});res.status(201).json({success:true,message:'Cuenta de personal creada. Debe cambiar la contraseña al iniciar sesión.'});
  }catch(e){fail(res,e)}
});
app.get('/api/admin/usuarios',auth,admin,async(req,res)=>{try{const cols=await columns('CuentasCliente'),p=await db();const pk=reqCol(cols,'accountId','id de cuenta');const roles=await columns('Roles'),rid=reqCol(roles,'roleId','id de rol'),rn=reqCol(roles,'roleName','rol');const r=await p.request().query(`SELECT c.${qid(pk.COLUMN_NAME)} AS id,c.${qid(reqCol(cols,'name','nombre').COLUMN_NAME)} AS nombre,c.${qid(reqCol(cols,'email','correo').COLUMN_NAME)} AS correo,c.${qid(reqCol(cols,'roleId','rol').COLUMN_NAME)} AS id_rol,r.${qid(rn.COLUMN_NAME)} AS rol,c.bloqueada FROM dbo.CuentasCliente c LEFT JOIN dbo.Roles r ON c.${qid(reqCol(cols,'roleId','rol').COLUMN_NAME)}=r.${qid(rid.COLUMN_NAME)} ORDER BY id`);res.json(r.recordset);}catch(e){fail(res,e);}});
app.put('/api/admin/usuarios/:id',auth,admin,async(req,res)=>{try{const cols=await columns('CuentasCliente'),id=reqCol(cols,'accountId','id de cuenta'),fields=[['name','nombre'],['surname','apellido_paterno'],['surname2','apellido_materno'],['email','correo'],['phone','telefono'],['license','licencia'],['roleId','id_rol']];const data=req.body||{},chosen=fields.map(([s,k])=>({c:col(cols,s),v:data[k]})).filter(x=>x.c&&x.v!==undefined);if(!chosen.length)return res.status(400).json({success:false,message:'No hay cambios válidos.'});const r=(await db()).request().input('id',sql.Int,Number(req.params.id));chosen.forEach((x,i)=>r.input('v'+i,x.v));const out=await r.query(`UPDATE dbo.CuentasCliente SET ${chosen.map((x,i)=>qid(x.c.COLUMN_NAME)+'=@v'+i).join(',')} WHERE ${qid(id.COLUMN_NAME)}=@id`);if(!out.rowsAffected[0])return res.status(404).json({success:false,message:'Cuenta no encontrada.'});await audit(req.user,'Actualizar cuenta','CuentasCliente',req.params.id,data);res.json({success:true,message:'Cuenta actualizada.'});}catch(e){fail(res,e);}});
app.post('/api/admin/usuarios/:id/bloqueo',auth,admin,async(req,res)=>{try{const blocked=Boolean(req.body?.bloqueada);if(blocked&&Number(req.params.id)===req.user.id)return res.status(400).json({success:false,message:'No puedes bloquear tu propia cuenta.'});await(await db()).request().input('id_cuenta',sql.Int,Number(req.params.id)).input('bloqueada',sql.Bit,blocked).execute('dbo.sp_BloquearCuenta');await audit(req.user,blocked?'Bloquear cuenta':'Desbloquear cuenta','CuentasCliente',req.params.id,{});res.json({success:true,message:blocked?'Cuenta bloqueada.':'Cuenta desbloqueada.'});}catch(e){fail(res,e);}});
app.delete('/api/admin/usuarios/:id',auth,admin,async(req,res)=>{try{if(Number(req.params.id)===req.user.id)return res.status(400).json({success:false,message:'No puedes eliminar la cuenta con la que tienes la sesión actual.'});const cols=await columns('CuentasCliente'),id=reqCol(cols,'accountId','id de cuenta');const r=await (await db()).request().input('id',sql.Int,Number(req.params.id)).query(`DELETE FROM dbo.CuentasCliente WHERE ${qid(id.COLUMN_NAME)}=@id`);if(!r.rowsAffected[0])return res.status(404).json({success:false,message:'Cuenta no encontrada.'});await audit(req.user,'Eliminar cuenta','CuentasCliente',req.params.id,{});res.json({success:true,message:'Cuenta eliminada.'});}catch(e){fail(res,e);}});

const RESERVATION_SELECT = `SELECT r.id,r.id_cuenta_cliente,r.costo_total,r.fecha_inicio,r.fecha_fin,er.nombre AS estado,v.marca,v.modelo,v.placa,ISNULL((SELECT SUM(p.monto) FROM dbo.Pagos p JOIN dbo.EstadosPago ep ON ep.id=p.id_estado_pago WHERE p.id_reservacion=r.id AND ep.nombre=N'Pagado'),0) AS total_pagado FROM dbo.Reservaciones r JOIN dbo.Vehiculos v ON v.id=r.id_vehiculo JOIN dbo.EstadosReservacion er ON er.id=r.id_estado_reservacion`;
async function getReservation(id){const result=await(await db()).request().input('id',sql.Int,id).query(RESERVATION_SELECT+' WHERE r.id=@id');return result.recordset[0]||null;}
function canManageReservation(req,row){return row&&(row.id_cuenta_cliente===req.user.id||req.user.role==='Administrador'||req.user.role==='Empleado');}
app.get('/api/perfil',auth,async(req,res)=>{try{const cols=await columns('CuentasCliente'),id=reqCol(cols,'accountId','cuenta'),name=reqCol(cols,'name','nombre'),surname=reqCol(cols,'surname','apellido'),surname2=col(cols,'surname2'),mail=reqCol(cols,'email','correo'),phone=reqCol(cols,'phone','teléfono'),license=col(cols,'license');const select=[['nombre',name],['apellido_paterno',surname],['apellido_materno',surname2],['correo',mail],['telefono',phone],['numero_licencia',license]].filter(x=>x[1]).map(([a,c])=>`${qid(c.COLUMN_NAME)} AS ${qid(a)}`).join(',');const r=await(await db()).request().input('id',sql.Int,req.user.id).query(`SELECT ${select} FROM dbo.CuentasCliente WHERE ${qid(id.COLUMN_NAME)}=@id`);if(!r.recordset.length)return res.status(404).json({success:false,message:'Cuenta no encontrada.'});res.json(r.recordset[0]);}catch(e){fail(res,e);}});
app.put('/api/perfil',auth,async(req,res)=>{const d=req.body||{},nombre=String(d.nombre||'').trim(),apellido=String(d.apellido_paterno||'').trim(),apellido2=String(d.apellido_materno||'').trim(),telefono=String(d.telefono||'').trim(),correo=String(d.correo||'').trim().toLowerCase(),licencia=String(d.numero_licencia||'').trim();if(!nombre||!apellido||nombre.length>50||apellido.length>50||apellido2.length>50||!/^[0-9]{10}$/.test(telefono)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)||correo.length>100||licencia.length>30)return res.status(400).json({success:false,message:'Revisa nombre, apellido, correo, teléfono de 10 dígitos y licencia.'});try{await(await db()).request().input('id_cuenta',sql.Int,req.user.id).input('nombre',sql.NVarChar(50),nombre).input('apellido_pat',sql.NVarChar(50),apellido).input('apellido_mat',sql.NVarChar(50),apellido2||null).input('telefono',sql.NVarChar(10),telefono).input('correo',sql.NVarChar(100),correo).input('numero_licencia',sql.NVarChar(30),licencia).execute('dbo.sp_ActualizarDatosCliente');req.user.nombre=nombre;req.user.apellido_paterno=apellido;req.user.correo=correo;await audit(req.user,'Actualizar perfil','CuentasCliente',req.user.id,{correo});res.json({success:true,message:'Tus datos fueron actualizados.'});}catch(e){fail(res,e);}});app.get('/api/mis-reservaciones',auth,async(req,res)=>{try{const r=await(await db()).request().input('id',sql.Int,req.user.id).query(RESERVATION_SELECT+' WHERE r.id_cuenta_cliente=@id ORDER BY r.id DESC');res.json(r.recordset);}catch(e){fail(res,e);}});
app.get('/api/admin/reservaciones',auth,admin,async(req,res)=>{try{const q=RESERVATION_SELECT.replace('SELECT r.id,','SELECT r.id,c.nombre+N\' \'+c.apellido_pat AS cliente,');const r=await(await db()).request().query(q+' JOIN dbo.CuentasCliente c ON c.id=r.id_cuenta_cliente ORDER BY r.id DESC');res.json(r.recordset);}catch(e){fail(res,e);}});
app.get('/api/empleado/reservaciones',auth,(req,res,next)=>req.user.role==='Empleado'||req.user.role==='Administrador'?next():res.status(403).json({success:false,message:'Acceso exclusivo para el personal.'}),async(req,res)=>{try{const q=RESERVATION_SELECT.replace('SELECT r.id,','SELECT r.id,c.nombre+N\' \'+c.apellido_pat AS cliente,');const r=await(await db()).request().query(q+' JOIN dbo.CuentasCliente c ON c.id=r.id_cuenta_cliente ORDER BY r.id DESC');res.json(r.recordset);}catch(e){fail(res,e);}});
app.post('/api/reservaciones',auth,async(req,res)=>{try{const {vehiculo_id,fecha_inicio,fecha_fin}=req.body||{};const a=new Date(`${fecha_inicio}T10:00:00`),b=new Date(`${fecha_fin}T10:00:00`);if(!Number.isFinite(a.valueOf())||!Number.isFinite(b.valueOf())||b<=a)return res.status(400).json({success:false,message:'La fecha de devolución debe ser posterior a la recogida.'});if(a<new Date(Date.now()-5*60*1000))return res.status(400).json({success:false,message:'La fecha de recogida ya pasó.'});const vehicle=await(await db()).request().input('id',sql.Int,Number(vehiculo_id)).query('SELECT id,id_sucursal FROM dbo.Vehiculos WHERE id=@id');if(!vehicle.recordset.length)return res.status(404).json({success:false,message:'El vehículo no existe.'});const branch=vehicle.recordset[0].id_sucursal;if(!branch)return res.status(400).json({success:false,message:'El vehículo no tiene una sucursal asignada.'});const r=await(await db()).request().input('id_cuenta_cliente',sql.Int,req.user.id).input('id_vehiculo',sql.Int,Number(vehiculo_id)).input('id_sucursal_recogida',sql.Int,branch).input('id_sucursal_entrega',sql.Int,Number(req.body.id_sucursal_entrega||branch)).input('fecha_inicio',sql.DateTime2,a).input('fecha_fin',sql.DateTime2,b).output('id_reservacion',sql.Int).execute('sp_CrearReservacion');res.status(201).json({success:true,message:'Reservación creada. Continúa con el pago.',id:r.output.id_reservacion});}catch(e){fail(res,e);}});
app.get('/api/reservaciones/:id/pago',auth,async(req,res)=>{try{const row=await getReservation(Number(req.params.id));if(!row||row.id_cuenta_cliente!==req.user.id&&req.user.role!=='Administrador')return res.status(404).json({success:false,message:'No se encontró la reservación.'});const methods=await(await db()).request().query('SELECT id,nombre FROM dbo.MetodosPago ORDER BY id');const total=Number(row.costo_total),paid=Number(row.total_pagado);res.json({id:row.id,total,pagado:paid,saldo:Math.max(0,total-paid),estado:row.estado,metodos:methods.recordset});}catch(e){fail(res,e);}});
app.post('/api/reservaciones/:id/pago',auth,async(req,res)=>{try{const row=await getReservation(Number(req.params.id));if(!row||row.id_cuenta_cliente!==req.user.id&&req.user.role!=='Administrador')return res.status(404).json({success:false,message:'No se encontró la reservación.'});const total=Number(row.costo_total),paid=Number(row.total_pagado),balance=total-paid,amount=Number(req.body?.monto),method=Number(req.body?.id_metodo_pago),reference=String(req.body?.referencia||'').trim();if(!Number.isFinite(amount)||amount<=0||amount>balance)return res.status(400).json({success:false,message:'El importe debe ser mayor a cero y no superar el saldo.'});if(!Number.isInteger(method))return res.status(400).json({success:false,message:'Elige un método de pago.'});const r=await(await db()).request().input('id_reservacion',sql.Int,row.id).input('id_metodo_pago',sql.Int,method).input('monto',sql.Decimal(10,2),amount).input('referencia',sql.NVarChar(100),reference||null).output('id_pago',sql.Int).execute('sp_RegistrarPago');res.json({success:true,message:'Pago registrado.',id_pago:r.output.id_pago,pagado:paid+amount,total,completo:paid+amount>=total});}catch(e){fail(res,e);}});
app.post('/api/reservaciones/:id/cancelar',auth,async(req,res)=>{try{const row=await getReservation(Number(req.params.id));if(!row||row.id_cuenta_cliente!==req.user.id)return res.status(404).json({success:false,message:'No se encontró la reservación.'});if(!['Pendiente','Confirmada'].includes(row.estado))return res.status(400).json({success:false,message:'Esta reservación ya no se puede cancelar.'});await(await db()).request().input('id_reservacion',sql.Int,row.id).execute('sp_CancelarReservacion');res.json({success:true,message:'Reservación cancelada.'});}catch(e){fail(res,e);}});
app.get('/api/reservaciones/:id/comprobante',auth,async(req,res)=>{try{const row=await getReservation(Number(req.params.id));if(!row||row.id_cuenta_cliente!==req.user.id&&req.user.role!=='Administrador'||Number(row.total_pagado)<Number(row.costo_total))return res.status(403).json({success:false,message:'El comprobante está disponible después de liquidar la reservación.'});const pays=await(await db()).request().input('id',sql.Int,row.id).query("SELECT p.id,p.monto,p.fecha_pago,p.referencia,mp.nombre AS metodo FROM dbo.Pagos p JOIN dbo.EstadosPago ep ON ep.id=p.id_estado_pago JOIN dbo.MetodosPago mp ON mp.id=p.id_metodo_pago WHERE p.id_reservacion=@id AND ep.nombre=N'Pagado' ORDER BY p.fecha_pago");res.json({reservacion:row,pagos:pays.recordset});}catch(e){fail(res,e);}});
app.post('/api/operaciones/reservaciones/:id/cancelar',auth,async(req,res)=>{if(!['Empleado','Administrador'].includes(req.user.role))return res.status(403).json({success:false,message:'Acceso exclusivo para el personal.'});try{await(await db()).request().input('id_reservacion',sql.Int,Number(req.params.id)).execute('sp_CancelarReservacion');res.json({success:true,message:'Reservación cancelada.'});}catch(e){fail(res,e);}});
app.post('/api/operaciones/reservaciones/:id/finalizar',auth,async(req,res)=>{if(!['Empleado','Administrador'].includes(req.user.role))return res.status(403).json({success:false,message:'Acceso exclusivo para el personal.'});try{const km=Number(req.body?.kilometraje_final);if(!Number.isFinite(km)||km<0)return res.status(400).json({success:false,message:'Escribe un kilometraje válido.'});await(await db()).request().input('id_reservacion',sql.Int,Number(req.params.id)).input('kilometraje_final',sql.Decimal(10,2),km).execute('sp_FinalizarReservacion');res.json({success:true,message:'Reservación finalizada.'});}catch(e){fail(res,e);}});

app.post('/api/reservaciones/:id/opinion',auth,async(req,res)=>{try{const rating=Number(req.body?.calificacion),comment=String(req.body?.comentario||'').trim();if(!Number.isInteger(rating)||rating<1||rating>5)return res.status(400).json({success:false,message:'La calificación debe ser de 1 a 5.'});const r=await(await db()).request().input('id_cuenta_cliente',sql.Int,req.user.id).input('id_reservacion',sql.Int,Number(req.params.id)).input('calificacion',sql.TinyInt,rating).input('comentario',sql.NVarChar(sql.MAX),comment||null).output('id_opinion',sql.Int).execute('dbo.sp_RegistrarOpinion');res.status(201).json({success:true,id:r.output.id_opinion,message:'Gracias por tu opinión.'});}catch(e){fail(res,e);}});
app.get('/api/empleado/mantenimientos',auth,(req,res,next)=>['Empleado','Administrador'].includes(req.user.role)?next():res.status(403).json({success:false,message:'Acceso exclusivo para personal.'}),async(req,res)=>{try{const r=await(await db()).request().query('SELECT m.id,m.id_vehiculo,m.fecha,m.tipo,m.descripcion,m.costo,m.kilometraje,v.marca,v.modelo,v.placa,ev.nombre AS estado_vehiculo FROM dbo.Mantenimientos m JOIN dbo.Vehiculos v ON v.id=m.id_vehiculo JOIN dbo.EstadosVehiculo ev ON ev.id=v.id_estado_vehiculo ORDER BY m.fecha DESC');res.json(r.recordset);}catch(e){fail(res,e);}});
app.get('/api/empleado/vehiculos',auth,(req,res,next)=>['Empleado','Administrador'].includes(req.user.role)?next():res.status(403).json({success:false,message:'Acceso exclusivo para personal.'}),async(req,res)=>{try{const r=await(await db()).request().query('SELECT v.id,v.marca,v.modelo,v.placa,v.kilometraje,ev.nombre AS estado FROM dbo.Vehiculos v JOIN dbo.EstadosVehiculo ev ON ev.id=v.id_estado_vehiculo WHERE ISNULL(v.retirado,0)=0 ORDER BY v.marca,v.modelo');res.json(r.recordset);}catch(e){fail(res,e);}});
app.post('/api/operaciones/mantenimientos',auth,async(req,res)=>{if(!['Empleado','Administrador'].includes(req.user.role))return res.status(403).json({success:false,message:'Acceso exclusivo para personal.'});try{const d=req.body||{},id=Number(d.id_vehiculo),costo=Number(d.costo),km=d.kilometraje===''||d.kilometraje==null?null:Number(d.kilometraje);if(!Number.isInteger(id)||!d.tipo||!d.descripcion||!Number.isFinite(costo)||costo<0||km!==null&&(!Number.isFinite(km)||km<0))return res.status(400).json({success:false,message:'Completa vehículo, tipo, descripción y costo válidos.'});const r=await(await db()).request().input('id_vehiculo',sql.Int,id).input('tipo',sql.NVarChar(50),d.tipo).input('descripcion',sql.NVarChar(sql.MAX),d.descripcion).input('costo',sql.Decimal(10,2),costo).input('kilometraje',sql.Decimal(10,2),km).output('id_mantenimiento',sql.Int).execute('dbo.sp_RegistrarMantenimiento');await audit(req.user,'Registrar mantenimiento','Mantenimientos',r.output.id_mantenimiento,d);res.status(201).json({success:true,id:r.output.id_mantenimiento,message:'Mantenimiento registrado; el vehículo quedó en mantenimiento.'});}catch(e){fail(res,e);}});
app.post('/api/operaciones/mantenimientos/:id/finalizar',auth,async(req,res)=>{if(!['Empleado','Administrador'].includes(req.user.role))return res.status(403).json({success:false,message:'Acceso exclusivo para personal.'});try{await(await db()).request().input('id_vehiculo',sql.Int,Number(req.params.id)).execute('dbo.sp_FinalizarMantenimiento');await audit(req.user,'Finalizar mantenimiento','Vehiculos',req.params.id,{});res.json({success:true,message:'Mantenimiento finalizado; el vehículo está disponible.'});}catch(e){fail(res,e);}});
app.get('/api/admin/errores',auth,admin,async(req,res)=>{try{const r=await(await db()).request().query('SELECT TOP 200 id,fecha,usuario,procedimiento,numero_error,mensaje FROM dbo.BitacoraErrores ORDER BY id DESC');res.json(r.recordset.map(e=>({...e,explicacion:explainSqlError(e.numero_error,e.mensaje)||e.mensaje})));}catch(e){fail(res,e);}});
app.delete('/api/admin/errores/:id',auth,admin,async(req,res)=>{try{const r=await(await db()).request().input('id',sql.BigInt,Number(req.params.id)).query('DELETE FROM dbo.BitacoraErrores WHERE id=@id');if(!r.rowsAffected[0])return res.status(404).json({success:false,message:'Ese error ya no existe.'});res.json({success:true,message:'Error eliminado de la bitácora.'});}catch(e){fail(res,e);}});
app.delete('/api/admin/errores',auth,admin,async(req,res)=>{try{const r=await(await db()).request().query('DELETE FROM dbo.BitacoraErrores');res.json({success:true,eliminados:r.rowsAffected[0]||0,message:'Bitácora de errores limpiada.'});}catch(e){fail(res,e);}});
app.get('/api/admin/ingresos',auth,admin,async(req,res)=>{try{const a=new Date(req.query.desde),b=new Date(req.query.hasta);if(!Number.isFinite(a.valueOf())||!Number.isFinite(b.valueOf())||b<=a)return res.status(400).json({success:false,message:'Indica un periodo válido.'});const r=await(await db()).request().input('fecha_inicio',sql.DateTime2,a).input('fecha_fin',sql.DateTime2,b).execute('dbo.sp_IngresosPorPeriodo');res.json({porMetodo:r.recordsets[0],total:r.recordsets[1]?.[0]?.total_general||0});}catch(e){fail(res,e);}});
const managedTables=['CategoriasVehiculo','EstadosPago','EstadosReservacion','EstadosVehiculo','MetodosPago','Roles','Sucursales','CuentasCliente','Vehiculos','Mantenimientos','Reservaciones','Pagos','Opiniones'];
function managedTable(name){if(!managedTables.includes(name))throw Object.assign(new Error('Tabla no permitida.'),{status:404});return name;}
function safeColumn(cols,name){return cols.find(c=>c.COLUMN_NAME===name);}
function accountSensitive(name){return ['contrasena','debe_cambiar_contrasena'].includes(String(name).toLowerCase());}
app.get('/api/admin/tablas',auth,admin,(req,res)=>res.json(managedTables));
app.get('/api/admin/tablas/:tabla',auth,admin,async(req,res)=>{try{const table=managedTable(req.params.tabla),cols=await columns(table),p=(await db()).request(),count=await p.query(`SELECT COUNT(*) AS total FROM dbo.${qid(table)}`),total=count.recordset[0].total,pages=Math.max(1,Math.ceil(total/100)),page=Math.max(1,Math.min(pages,Number(req.query.pagina)||1));const rows=await p.input('offset',sql.Int,(page-1)*100).query(`SELECT * FROM dbo.${qid(table)} ORDER BY 1 DESC OFFSET @offset ROWS FETCH NEXT 100 ROWS ONLY`);res.json({tabla:table,columnas:cols.filter(c=>!accountSensitive(c.COLUMN_NAME)),filas:rows.recordset.map(row=>Object.fromEntries(Object.entries(row).filter(([k])=>!accountSensitive(k)))),total,pagina:page,paginas:pages});}catch(e){fail(res,e);}});
app.post('/api/admin/tablas/:tabla',auth,admin,async(req,res)=>{try{const table=managedTable(req.params.tabla),cols=await columns(table),data=req.body||{},chosen=[];for(const [name,raw] of Object.entries(data)){const c=safeColumn(cols,name);if(!c||/^id$/i.test(c.COLUMN_NAME)||accountSensitive(name))continue;let value=raw;if(value===''&&c.IS_NULLABLE==='YES')value=null;if(value!==''&&value!==undefined)chosen.push([c,value]);}if(table==='CuentasCliente'){const pass=req.body?.contrasena;if(!passwordIsStrong(pass))return res.status(400).json({success:false,message:'La contraseña requiere 8 caracteres, letra, número y carácter especial.'});const passCol=col(cols,'password');if(!passCol)return res.status(400).json({success:false,message:'La tabla de cuentas no tiene columna de contraseña.'});chosen.push([passCol,await hashPassword(pass)]);const roleCol=col(cols,'roleId');if(roleCol&&!chosen.some(([c])=>c.COLUMN_NAME===roleCol.COLUMN_NAME)){const clientId=await catalogId('Roles','Cliente');if(clientId==null)return res.status(400).json({success:false,message:'No se encontró rol para la cuenta.'});chosen.push([roleCol,clientId]);}const reset=col(cols,'passwordReset');if(reset)chosen.push([reset,0]);}if(!chosen.length)return res.status(400).json({success:false,message:'Agrega al menos un campo.'});const r=(await db()).request();chosen.forEach(([c,v],i)=>r.input('v'+i,typedValue(c,v)));await r.query(`INSERT INTO dbo.${qid(table)} (${chosen.map(([c])=>qid(c.COLUMN_NAME)).join(',')}) VALUES (${chosen.map((_,i)=>'@v'+i).join(',')})`);await audit(req.user,'Crear registro',table,null,data);res.status(201).json({success:true,message:'Registro creado.'});}catch(e){fail(res,e);}});
app.put('/api/admin/tablas/:tabla/:id',auth,admin,async(req,res)=>{try{const table=managedTable(req.params.tabla),cols=await columns(table),pk=cols.find(c=>/^id$/i.test(c.COLUMN_NAME));if(!pk)return res.status(400).json({success:false,message:'La tabla no tiene una clave id compatible.'});const chosen=[];for(const [name,raw] of Object.entries(req.body||{})){const c=safeColumn(cols,name);if(!c||/^id$/i.test(name)||accountSensitive(name))continue;let value=raw;if(value!==undefined&&value!=='')chosen.push([c,typedValue(c,value)]);}if(table==='CuentasCliente'&&req.body?.contrasena){if(!passwordIsStrong(req.body.contrasena))return res.status(400).json({success:false,message:'La contraseña requiere 8 caracteres, letra, número y carácter especial.'});chosen.push([reqCol(cols,'password','contraseña'),await hashPassword(req.body.contrasena)]);const reset=col(cols,'passwordReset');if(reset)chosen.push([reset,0]);}if(!chosen.length)return res.status(400).json({success:false,message:'No hay cambios para guardar.'});const r=(await db()).request().input('id',sql.Int,Number(req.params.id));chosen.forEach(([c,v],i)=>r.input('v'+i,v));const out=await r.query(`UPDATE dbo.${qid(table)} SET ${chosen.map(([c],i)=>`${qid(c.COLUMN_NAME)}=@v${i}`).join(',')} WHERE ${qid(pk.COLUMN_NAME)}=@id`);if(!out.rowsAffected[0])return res.status(404).json({success:false,message:'Registro no encontrado.'});await audit(req.user,'Actualizar registro',table,req.params.id,req.body||{});res.json({success:true,message:'Cambios guardados.'});}catch(e){fail(res,e);}});
app.delete('/api/admin/tablas/:tabla/:id',auth,admin,async(req,res)=>{try{const table=managedTable(req.params.tabla),cols=await columns(table),pk=cols.find(c=>/^id$/i.test(c.COLUMN_NAME));if(!pk)return res.status(400).json({success:false,message:'La tabla no tiene una clave id compatible.'});if(table==='CuentasCliente'&&Number(req.params.id)===req.user.id)return res.status(400).json({success:false,message:'No puedes eliminar la cuenta Administrador con sesión activa.'});const out=await(await db()).request().input('id',sql.Int,Number(req.params.id)).query(`DELETE FROM dbo.${qid(table)} WHERE ${qid(pk.COLUMN_NAME)}=@id`);if(!out.rowsAffected[0])return res.status(404).json({success:false,message:'Registro no encontrado.'});await audit(req.user,'Eliminar registro',table,req.params.id,{});res.json({success:true,message:'Registro eliminado.'});}catch(e){fail(res,e);}});
app.get('/api/admin/estadisticas',auth,admin,async(req,res)=>{try{const p=await db();const totals=await p.request().query("SELECT (SELECT COUNT(*) FROM dbo.Vehiculos WHERE ISNULL(retirado,0)=0) AS vehiculos,(SELECT COUNT(*) FROM dbo.CuentasCliente) AS usuarios,(SELECT COUNT(*) FROM dbo.Reservaciones) AS reservaciones,(SELECT COUNT(*) FROM dbo.Pagos) AS pagos,(SELECT COALESCE(SUM(p.monto),0) FROM dbo.Pagos p JOIN dbo.EstadosPago ep ON ep.id=p.id_estado_pago WHERE ep.nombre=N'Pagado') AS ingresos,(SELECT AVG(CAST(calificacion AS FLOAT)) FROM dbo.Opiniones) AS calificacion");const byStatus=await p.request().query('SELECT er.nombre,COUNT(r.id) AS total FROM dbo.EstadosReservacion er LEFT JOIN dbo.Reservaciones r ON r.id_estado_reservacion=er.id GROUP BY er.nombre ORDER BY er.nombre');const fleet=await p.request().query('SELECT ev.nombre,COUNT(v.id) AS total FROM dbo.EstadosVehiculo ev LEFT JOIN dbo.Vehiculos v ON v.id_estado_vehiculo=ev.id GROUP BY ev.nombre ORDER BY ev.nombre');res.json({...totals.recordset[0],reservacionesPorEstado:byStatus.recordset,flotaPorEstado:fleet.recordset});}catch(e){fail(res,e);}});
app.get('/api/admin/roles',auth,admin,async(req,res)=>{try{const cols=await columns('Roles'),id=reqCol(cols,'roleId','id de rol'),label=reqCol(cols,'roleName','nombre de rol');const r=await (await db()).request().query(`SELECT ${qid(id.COLUMN_NAME)} AS id,${qid(label.COLUMN_NAME)} AS nombre FROM dbo.Roles ORDER BY 1`);res.json(r.recordset);}catch(e){fail(res,e);}});
app.get('/api/health',async(req,res)=>{try{await db();res.json({ok:true});}catch(e){res.status(503).json({ok:false,message:'SQL Server no está disponible.'});}});
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
const port=Number(process.env.PORT||5000);app.listen(port,'127.0.0.1',()=>console.log('🚀 Mexico Runs listo en http://localhost:'+port));



