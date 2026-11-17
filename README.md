# Mexico Runs — ASP.NET Core .NET 8

Mexico Runs es un sistema web para renta de vehículos. El servidor ahora está escrito en C# con ASP.NET Core 8 y se conecta a SQL Server con `Microsoft.Data.SqlClient`. Las páginas HTML, CSS y JavaScript del navegador se conservan en `wwwroot` y consumen las mismas rutas `/api/...`.

## Cómo ejecutarlo

1. Instala el **SDK .NET 8** y SQL Server.
2. Revisa `.env`: `DB_SERVER`, `DB_DATABASE=MexicoRuns2`, `DB_USER`, `DB_PASSWORD`; para SQL Express usa `DB_INSTANCE=SQLEXPRESS02`, o define `DB_PORT` si corresponde.
3. Abre `C:\Users\josav\OneDrive\Desktop\MexicoRuns` en Visual Studio Code.
4. Abre una terminal en esa carpeta y ejecuta:

   ```powershell
   dotnet restore MexicoRuns.csproj
   dotnet run --project MexicoRuns.csproj --no-launch-profile
   ```

5. Abre `http://localhost:5000`. Conserva abierta la terminal. También puedes hacer doble clic en `Iniciar Mexico Runs.bat`.
6. Para detenerlo, presiona `Ctrl + C` en la terminal.

`npm start` también ejecuta `dotnet run`, pero el comando recomendado para explicar la aplicación es `dotnet run --project MexicoRuns.csproj --no-launch-profile`.

## Base de datos

El servidor aplica al iniciar los lotes `GO` de `database/MejorasMexicoRuns.sql`. Para crear la base desde cero, primero ejecuta en SSMS `database/MexicoRuns.sql` y `database/Procedimientos_MexicoRuns2.sql`; después inicia la aplicación .NET para que aplique la migración de mejoras.

Para los requisitos de normalización, CRUD y diagrama ER, consulta database/ENTREGA_BASE_DATOS.md. Usa database/verificar_entrega.sql como comprobación de solo lectura; el diagrama debe guardarse desde **Diagramas de base de datos** en SSMS.

## Cómo explicarlo en clase

- **ASP.NET Core / Minimal APIs:** `Program.cs` registra las rutas HTTP `GET`, `POST`, `PUT` y `DELETE` que antes vivían en Express.
- **Frontend:** `wwwroot` contiene las páginas, estilos e interacciones del navegador. Las pantallas llaman a `/api/...`; por eso conservan los nombres de rutas y campos.
- **SQL Server:** `Microsoft.Data.SqlClient` abre conexiones. Las consultas parametrizadas leen o actualizan tablas y `Proc(...)` ejecuta procedimientos almacenados como `sp_CrearReservacion`, `sp_RegistrarPago` y `sp_RegistrarMantenimiento`.
- **DTOs:** los `record` al final de `Program.cs` reciben y validan los JSON de formularios, como login, registro, reservaciones y pagos.
- **Autenticación y roles:** el login verifica el hash, emite una cookie `HttpOnly` y guarda la sesión en memoria. `Deny(...)` protege las rutas para Administrador o personal. La sesión se pierde si se reinicia el servidor.
- **Seguridad de contraseñas:** las nuevas usan PBKDF2 con SHA-256. Los hashes `scrypt` antiguos se reconocen y actualizan a PBKDF2 al iniciar sesión por primera vez.
- **Errores y auditoría:** los errores SQL se guardan en `BitacoraErrores`; las operaciones administrativas importantes se anotan en `BitacoraAuditoria`.
- **Archivos estáticos:** `UseDefaultFiles` y `UseStaticFiles` sirven las páginas desde `wwwroot`. La página `basededatos.html` tiene una comprobación adicional de rol.

## Funciones disponibles

- Cliente: registro, login, editar perfil, ver vehículos, reservar, pagar, cancelar, consultar historial, opinar y descargar/imprimir comprobante tras liquidar.
- Empleado: consultar reservas, finalizarlas, cancelarlas según la política y registrar/finalizar mantenimientos.
- Administrador: dashboard, vehículos, cuentas/roles/bloqueo, reservaciones, tablas CRUD permitidas, bitácora de errores e ingresos por periodo.

Los pagos son demostrativos; no realizan cargos reales. El proyecto todavía está configurado para ejecutarse localmente y aún no está publicado en hosting.

## Archivos anteriores de Node.js

`server.js` se conserva como referencia temporal, pero el lanzador y `npm start` ya usan .NET 8. El JavaScript de `wwwroot` sí sigue siendo necesario para las interacciones del navegador; no es el servidor Node.

## Módulos añadidos

- `wwwroot/admin-servicios.html`: coordenadas reportadas, evaluaciones internas, revisión manual de licencias/placas, propuestas de propietarios y solicitudes de factura.
- `wwwroot/propietarios.html`: formulario público para proponer un vehículo.
- `wwwroot/verificar-correo.html`: confirma un enlace SMTP de un solo uso (30 minutos). Configura `SMTP_HOST`, `SMTP_PORT`, `SMTP_SSL`, `SMTP_FROM`, `SMTP_USER` y `SMTP_PASSWORD` en `.env`; los valores reales no deben guardarse en Git.
- `database/MejorasMexicoRuns.sql`: crea las tablas nuevas idempotentemente al arrancar el servidor .NET 8.

Las coordenadas son manuales/demo hasta instalar un GPS y conectar su proveedor. Las revisiones de licencia y placas son manuales, no verificaciones ante SICT. Las propuestas y porcentajes son orientativos, no contratos ni garantías. El PDF actual es comprobante informativo imprimible, no CFDI; una factura fiscal debe timbrarse con SAT/PAC. Los pagos siguen siendo de demostración y no se deben guardar CVV ni números completos de tarjeta.

### Activar integraciones opcionales

- GPS: configura `GPS_INGEST_API_KEY` como secreto y configura el proveedor para enviar `POST /api/integraciones/gps/{idVehiculo}` con header `X-GPS-API-Key` y JSON `{ "latitud": 16.75, "longitud": -93.12 }`. Sin un rastreador/proveedor compatible, solo se pueden guardar posiciones manuales.
- Exigir correo verificado antes de reservar: configura `REQUIRE_VERIFIED_EMAIL=true` después de configurar SMTP y reinicia el servidor. Con `false`, el sistema permite continuar sin esa verificación.
