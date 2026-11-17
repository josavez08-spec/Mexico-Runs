# Guía breve para exponer Mexico Runs en .NET 8

## Demostración en 3 a 5 minutos

1. **Presenta la arquitectura.** “La página del navegador conserva HTML, CSS y JavaScript. El servidor está en C# con ASP.NET Core 8, y SQL Server guarda los datos.” Abre `MexicoRuns.csproj` y `Program.cs`.
2. **Arranca la aplicación.** En PowerShell, desde la carpeta del proyecto: `dotnet run --project MexicoRuns.csproj --no-launch-profile`. El servidor local escucha en `http://localhost:5000`. También se puede abrir `Iniciar Mexico Runs.bat`.
3. **Explica una ruta sencilla.** En `Program.cs`, busca `app.MapGet("/api/flota/resumen"...)`. `MapGet` recibe solicitudes GET, consulta SQL Server y devuelve JSON. La página Inicio lee ese JSON para mostrar vehículos disponibles y en mantenimiento.
4. **Explica registro y login.** Las rutas `MapPost("/api/registro"...)` y `MapPost("/api/login"...)` reciben JSON del formulario. El registro llama a `sp_RegistrarCuentaCliente`; el login comprueba la contraseña y crea una cookie de sesión `HttpOnly`.
5. **Explica roles.** `Deny(context,"Administrador")` impide que un Cliente o Empleado use rutas de Administración. Las APIs del empleado usan `Deny(context,"Empleado")`, que también admite Administrador.
6. **Explica base de datos.** `Query(...)` ejecuta consultas parametrizadas; `Proc(...)` invoca procedimientos almacenados. Por ejemplo, `sp_CrearReservacion` valida disponibilidad y guarda la reserva; `sp_RegistrarPago` registra el pago.
7. **Muestra las tres vistas.** Cliente: reservar y ver comprobante; Empleado: atender rentas y mantenimiento; Administrador: usuarios, flota, auditoría y dashboard.

## Qué significa cada parte del código

- **`app.MapGet` / `app.MapPost` / `app.MapPut` / `app.MapDelete`:** conectan una URL y un verbo HTTP con una función C#.
- **`HttpContext`:** contiene la solicitud, cookies y respuesta HTTP.
- **DTOs (`LoginDto`, `ReservationDto`, etc.):** modelos que ASP.NET llena con los datos JSON.
- **`SqlParameter`:** envía valores a SQL Server como parámetros, sin concatenarlos al SQL.
- **`record`:** tipo compacto para representar datos del formulario o la sesión.
- **`IResult`:** respuesta HTTP, como `200 OK`, `400 Bad Request` o `401 Unauthorized`.
- **`wwwroot`:** archivos estáticos que ASP.NET entrega al navegador.
- **`.env`:** conexión local a SQL Server; la contraseña no debe ponerse en una exposición, captura o repositorio público.

## Limitaciones que conviene mencionar

- La app funciona localmente; para el requisito de hosting falta publicar el sitio y configurar SQL Server accesible desde ese entorno.
- La sesión se guarda en memoria, así que reiniciar el servidor cierra las sesiones activas.
- Los pagos son demostrativos y no procesan tarjetas reales.
- Node `server.js` se conserva por ahora como referencia; no es el servidor que arranca el `.bat` ni `npm start`.

## Si el profesor pregunta “¿qué pasa al reservar?”

“El navegador envía el formulario a `/api/reservaciones`. ASP.NET comprueba que exista la sesión, llama al procedimiento `sp_CrearReservacion`, SQL Server verifica disponibilidad y guarda el folio. Luego el usuario registra el pago; cuando queda liquidado se habilita el comprobante imprimible.”
