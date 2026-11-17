require('dotenv').config();
const sql = require('mssql');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { Writable } = require('node:stream');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  ...(process.env.DB_PORT ? { port: Number(process.env.DB_PORT) } : {}),
  options: { encrypt: false, trustServerCertificate: true,
    ...(!process.env.DB_PORT && process.env.DB_INSTANCE ? { instanceName: process.env.DB_INSTANCE } : {}) }
};
const output = new Writable({ write(chunk, encoding, callback) { if (!output.hidden) process.stdout.write(chunk); callback(); } });
output.cursorTo = (...args) => process.stdout.cursorTo?.(...args);
output.clearLine = (...args) => process.stdout.clearLine?.(...args);
output.moveCursor = (...args) => process.stdout.moveCursor?.(...args);
const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
function ask(prompt, hidden = false) {
  output.hidden = hidden;
  if (hidden) process.stdout.write(prompt);
  return new Promise(resolve => rl.question(hidden ? '' : prompt, answer => { output.hidden = false; if (hidden) process.stdout.write('\n'); resolve(answer.trim()); }));
}
function strong(password) {
  return password.length >= 8 && /[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9ÁÉÍÓÚáéíóúÑñ]/.test(password);
}
async function main() {
  const nombre = await ask('Nombre: ');
  const apellido = await ask('Apellido paterno: ');
  const correo = (await ask('Correo: ')).toLowerCase();
  const telefono = await ask('Teléfono (10 dígitos): ');
  const password = await ask('Contraseña fuerte (entrada oculta): ', true);
  const confirm = await ask('Repite la contraseña (entrada oculta): ', true);
  if (!nombre || !apellido || !/^\S+@\S+\.\S+$/.test(correo) || !/^\d{10}$/.test(telefono)) throw new Error('Revisa nombre, apellido, correo y teléfono.');
  if (!strong(password) || password !== confirm) throw new Error('La contraseña no cumple la regla o no coincide.');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = 'scrypt$' + salt + '$' + (await scrypt(password, salt, 64)).toString('hex');
  const pool = await sql.connect(config);
  const role = await pool.request().query("SELECT TOP 1 id FROM dbo.Roles WHERE nombre_rol=N'Administrador'");
  if (!role.recordset.length) throw new Error('No existe el rol Administrador. Ejecuta primero los procedimientos SQL.');
  const exists = await pool.request().input('correo', sql.NVarChar(100), correo).query('SELECT TOP 1 id FROM dbo.CuentasCliente WHERE LOWER(correo)=@correo');
  if (exists.recordset.length) throw new Error('Ya existe una cuenta con ese correo.');
  const hasFlag = await pool.request().query("SELECT CASE WHEN COL_LENGTH('dbo.CuentasCliente','debe_cambiar_contrasena') IS NULL THEN 0 ELSE 1 END AS existe");
  const extraColumn = hasFlag.recordset[0].existe ? ',debe_cambiar_contrasena' : '';
  const extraValue = hasFlag.recordset[0].existe ? ',0' : '';
  await pool.request().input('nombre', sql.NVarChar(50), nombre).input('apellido', sql.NVarChar(50), apellido)
    .input('telefono', sql.NVarChar(10), telefono).input('correo', sql.NVarChar(100), correo)
    .input('password', sql.NVarChar(255), hash).input('rol', sql.Int, role.recordset[0].id)
    .query('INSERT INTO dbo.CuentasCliente(nombre,apellido_pat,telefono,correo,contrasena,numero_licencia,id_rol'+extraColumn+') VALUES(@nombre,@apellido,@telefono,@correo,@password,N\'ADMIN\',@rol'+extraValue+')');
  console.log('Cuenta Administrador creada. Ya puedes iniciar sesión en Mexico Runs.');
  await pool.close();
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => rl.close());
