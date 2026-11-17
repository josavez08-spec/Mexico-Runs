const sql = require('mssql');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const readline = require('node:readline/promises');
require('dotenv').config();

const scrypt = promisify(crypto.scrypt);
const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  ...(process.env.DB_PORT ? { port: Number(process.env.DB_PORT) } : {}),
  options: { encrypt: false, trustServerCertificate: true }
};

function askHidden(prompt) {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    return Promise.reject(new Error('Ejecuta este archivo desde una terminal interactiva de VS Code.'));
  }
  return new Promise((resolve, reject) => {
    let value = '';
    const onData = chunk => {
      const key = chunk.toString('utf8');
      if (key === '\u0003') {
        input.setRawMode(false);
        input.pause();
        input.removeListener('data', onData);
        reject(new Error('Operación cancelada.'));
        return;
      }
      if (key === '\r' || key === '\n') {
        input.setRawMode(false);
        input.pause();
        input.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(value);
        return;
      }
      if (key === '\u0008' || key === '\u007f') value = value.slice(0, -1);
      else if (!key.startsWith('\u001b') && !/[\u0000-\u001f]/.test(key)) value += key;
    };
    process.stdout.write(prompt);
    input.setEncoding('utf8');
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

(async () => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let pool;
  try {
    const email = (await rl.question('Correo de la cuenta: ')).trim().toLowerCase();
    rl.close();
    const password = await askHidden('Nueva contraseña (mínimo 8 caracteres, no se muestra): ');
    const confirm = await askHidden('Repite la nueva contraseña: ');
    if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
    if (password !== confirm) throw new Error('Las contraseñas no coinciden.');

    const salt = crypto.randomBytes(16).toString('hex');
    const key = await scrypt(password, salt, 64);
    const hash = `scrypt$${salt}$${key.toString('hex')}`;
    pool = await sql.connect(config);
    const result = await pool.request()
      .input('email', sql.NVarChar(100), email)
      .input('hash', sql.NVarChar(255), hash)
      .query('UPDATE dbo.CuentasCliente SET contrasena=@hash WHERE LOWER(correo)=@email');
    if (!result.rowsAffected[0]) throw new Error('No encontré esa cuenta en la base de datos configurada.');
    console.log('Contraseña actualizada. Inicia sesión con ese correo y la nueva contraseña.');
  } catch (error) {
    console.error('No se pudo cambiar la contraseña:', error.message);
    process.exitCode = 1;
  } finally {
    rl.close();
    if (process.stdin.isTTY && process.stdin.isRaw) process.stdin.setRawMode(false);
    if (pool) await pool.close();
  }
})();
