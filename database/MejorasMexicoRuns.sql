USE MexicoRuns2;
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
GO
/* Sucursales iniciales; se omiten si ya hay una sede en esa ciudad. */
IF NOT EXISTS (SELECT 1 FROM dbo.Sucursales WHERE ciudad COLLATE Latin1_General_100_CI_AI LIKE N'%Tuxtla%')
  INSERT dbo.Sucursales(nombre,ciudad,estado) VALUES(N'MexicoRuns Tuxtla Centro',N'Tuxtla Gutiérrez',N'Chiapas');
IF NOT EXISTS (SELECT 1 FROM dbo.Sucursales WHERE ciudad COLLATE Latin1_General_100_CI_AI LIKE N'%Ciudad de Mexico%')
  INSERT dbo.Sucursales(nombre,ciudad,estado) VALUES(N'MexicoRuns Aeropuerto CDMX',N'Ciudad de México',N'Ciudad de México');
IF NOT EXISTS (SELECT 1 FROM dbo.Sucursales WHERE ciudad COLLATE Latin1_General_100_CI_AI LIKE N'%Cancun%')
  INSERT dbo.Sucursales(nombre,ciudad,estado) VALUES(N'MexicoRuns Cancún Centro',N'Cancún',N'Quintana Roo');
GO
/* Migración segura e idempotente: agrega control de cuentas y bitácoras. */
IF COL_LENGTH('dbo.CuentasCliente','bloqueada') IS NULL
BEGIN
  ALTER TABLE dbo.CuentasCliente ADD bloqueada BIT NOT NULL
    CONSTRAINT DF_CuentasCliente_bloqueada DEFAULT (0) WITH VALUES;
END;
GO

IF COL_LENGTH('dbo.Vehiculos','retirado') IS NULL
BEGIN
  ALTER TABLE dbo.Vehiculos ADD retirado BIT NOT NULL
    CONSTRAINT DF_Vehiculos_retirado DEFAULT (0) WITH VALUES;
END;
GO

IF OBJECT_ID('dbo.BitacoraErrores','U') IS NULL
BEGIN
  CREATE TABLE dbo.BitacoraErrores(
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    fecha DATETIME2 NOT NULL CONSTRAINT DF_BitacoraErrores_fecha DEFAULT SYSDATETIME(),
    usuario NVARCHAR(100) NULL,
    procedimiento NVARCHAR(128) NULL,
    numero_error INT NULL,
    severidad INT NULL,
    estado INT NULL,
    linea INT NULL,
    mensaje NVARCHAR(MAX) NOT NULL
  );
END;
GO

IF OBJECT_ID('dbo.BitacoraAuditoria','U') IS NULL
BEGIN
  CREATE TABLE dbo.BitacoraAuditoria(
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    fecha DATETIME2 NOT NULL CONSTRAINT DF_BitacoraAuditoria_fecha DEFAULT SYSDATETIME(),
    id_usuario INT NULL,
    rol NVARCHAR(50) NULL,
    accion NVARCHAR(50) NOT NULL,
    tabla NVARCHAR(128) NOT NULL,
    id_registro NVARCHAR(100) NULL,
    detalle NVARCHAR(MAX) NULL
  );
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_RegistrarError
  @usuario NVARCHAR(100)=NULL,@procedimiento NVARCHAR(128)=NULL,
  @numero_error INT=NULL,@severidad INT=NULL,@estado INT=NULL,
  @linea INT=NULL,@mensaje NVARCHAR(MAX)
AS
BEGIN
  SET NOCOUNT ON;
  INSERT dbo.BitacoraErrores(usuario,procedimiento,numero_error,severidad,estado,linea,mensaje)
  VALUES(@usuario,@procedimiento,@numero_error,@severidad,@estado,@linea,@mensaje);
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_RegistrarCuentaCliente
  @nombre NVARCHAR(50),@apellido_pat NVARCHAR(50),@apellido_mat NVARCHAR(50)=NULL,
  @telefono NVARCHAR(10),@correo NVARCHAR(100),@contrasena NVARCHAR(255),
  @numero_licencia NVARCHAR(30),@id_rol INT=NULL,@id_cuenta INT OUTPUT
AS
BEGIN
  SET NOCOUNT ON;
  BEGIN TRY
    IF EXISTS(SELECT 1 FROM dbo.CuentasCliente WHERE LOWER(correo)=LOWER(@correo))
      THROW 50001,'Ya existe una cuenta con ese correo.',1;
    IF @id_rol IS NULL SELECT @id_rol=id FROM dbo.Roles WHERE nombre_rol='Cliente';
    IF @id_rol IS NULL OR NOT EXISTS(SELECT 1 FROM dbo.Roles WHERE id=@id_rol)
      THROW 50002,'El rol indicado no existe.',1;
    INSERT dbo.CuentasCliente(nombre,apellido_pat,apellido_mat,telefono,correo,contrasena,numero_licencia,id_rol,debe_cambiar_contrasena,bloqueada)
    VALUES(@nombre,@apellido_pat,@apellido_mat,@telefono,@correo,@contrasena,@numero_licencia,@id_rol,0,0);
    SET @id_cuenta=SCOPE_IDENTITY();
  END TRY
  BEGIN CATCH
    INSERT dbo.BitacoraErrores(procedimiento,numero_error,severidad,estado,linea,mensaje)
    VALUES(ERROR_PROCEDURE(),ERROR_NUMBER(),ERROR_SEVERITY(),ERROR_STATE(),ERROR_LINE(),ERROR_MESSAGE());
    THROW;
  END CATCH
END;
GO
CREATE OR ALTER PROCEDURE dbo.sp_BloquearCuenta
  @id_cuenta INT,@bloqueada BIT
AS
BEGIN
  SET NOCOUNT ON;
  BEGIN TRY
    UPDATE dbo.CuentasCliente SET bloqueada=@bloqueada WHERE id=@id_cuenta;
    IF @@ROWCOUNT=0 THROW 50101,'No existe la cuenta indicada.',1;
  END TRY
  BEGIN CATCH
    INSERT dbo.BitacoraErrores(procedimiento,numero_error,severidad,estado,linea,mensaje)
    VALUES(ERROR_PROCEDURE(),ERROR_NUMBER(),ERROR_SEVERITY(),ERROR_STATE(),ERROR_LINE(),ERROR_MESSAGE());
    THROW;
  END CATCH
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ActualizarDatosCliente
  @id_cuenta INT,@nombre NVARCHAR(50),@apellido_pat NVARCHAR(50),
  @apellido_mat NVARCHAR(50)=NULL,@telefono NVARCHAR(10),@correo NVARCHAR(100),
  @numero_licencia NVARCHAR(30)
AS
BEGIN
  SET NOCOUNT ON;
  BEGIN TRY
    UPDATE dbo.CuentasCliente
    SET nombre=@nombre,apellido_pat=@apellido_pat,apellido_mat=@apellido_mat,
        telefono=@telefono,correo=@correo,numero_licencia=@numero_licencia
    WHERE id=@id_cuenta AND bloqueada=0;
    IF @@ROWCOUNT=0 THROW 50102,'La cuenta no existe o está bloqueada.',1;
  END TRY
  BEGIN CATCH
    INSERT dbo.BitacoraErrores(procedimiento,numero_error,severidad,estado,linea,mensaje)
    VALUES(ERROR_PROCEDURE(),ERROR_NUMBER(),ERROR_SEVERITY(),ERROR_STATE(),ERROR_LINE(),ERROR_MESSAGE());
    THROW;
  END CATCH
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_CancelarReservacion
  @id_reservacion INT,@forzar BIT=0
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @id_cancelada INT,@id_disponible INT,@id_pagado INT,@id_reembolsado INT,
          @id_vehiculo INT,@estado_actual NVARCHAR(50),@fecha_inicio DATETIME2;
  BEGIN TRY
    SELECT @id_vehiculo=r.id_vehiculo,@estado_actual=er.nombre,@fecha_inicio=r.fecha_inicio
    FROM dbo.Reservaciones r JOIN dbo.EstadosReservacion er ON er.id=r.id_estado_reservacion
    WHERE r.id=@id_reservacion;
    IF @id_vehiculo IS NULL THROW 50030,'La reservación no existe.',1;
    IF @estado_actual IN ('Finalizada','Cancelada') THROW 50031,'La reservación ya está Finalizada o Cancelada.',1;
    IF @forzar=0 AND DATEDIFF(DAY,CONVERT(date,SYSDATETIME()),CONVERT(date,@fecha_inicio))<6
      THROW 50032,'La cancelación debe solicitarse al menos 6 días antes de la recogida.',1;
    BEGIN TRANSACTION;
    SELECT @id_cancelada=id FROM dbo.EstadosReservacion WHERE nombre='Cancelada';
    SELECT @id_disponible=id FROM dbo.EstadosVehiculo WHERE nombre='Disponible';
    SELECT @id_pagado=id FROM dbo.EstadosPago WHERE nombre='Pagado';
    SELECT @id_reembolsado=id FROM dbo.EstadosPago WHERE nombre='Reembolsado';
    UPDATE dbo.Reservaciones SET id_estado_reservacion=@id_cancelada WHERE id=@id_reservacion;
    UPDATE dbo.Vehiculos SET id_estado_vehiculo=@id_disponible WHERE id=@id_vehiculo;
    UPDATE dbo.Pagos SET id_estado_pago=@id_reembolsado
      WHERE id_reservacion=@id_reservacion AND id_estado_pago=@id_pagado;
    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    INSERT dbo.BitacoraErrores(procedimiento,numero_error,severidad,estado,linea,mensaje)
    VALUES(ERROR_PROCEDURE(),ERROR_NUMBER(),ERROR_SEVERITY(),ERROR_STATE(),ERROR_LINE(),ERROR_MESSAGE());
    THROW;
  END CATCH
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_FinalizarMantenimiento
  @id_vehiculo INT
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @id_disponible INT,@id_mantenimiento INT;
  BEGIN TRY
    SELECT @id_disponible=id FROM dbo.EstadosVehiculo WHERE nombre='Disponible';
    SELECT @id_mantenimiento=id FROM dbo.EstadosVehiculo WHERE nombre='En mantenimiento';
    UPDATE dbo.Vehiculos SET id_estado_vehiculo=@id_disponible
      WHERE id=@id_vehiculo AND id_estado_vehiculo=@id_mantenimiento;
    IF @@ROWCOUNT=0 THROW 50060,'El vehículo no existe o no está En mantenimiento.',1;
  END TRY
  BEGIN CATCH
    INSERT dbo.BitacoraErrores(procedimiento,numero_error,severidad,estado,linea,mensaje)
    VALUES(ERROR_PROCEDURE(),ERROR_NUMBER(),ERROR_SEVERITY(),ERROR_STATE(),ERROR_LINE(),ERROR_MESSAGE());
    THROW;
  END CATCH
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_RegistrarOpinion
  @id_cuenta_cliente INT,@id_reservacion INT,@calificacion TINYINT,
  @comentario NVARCHAR(MAX)=NULL,@id_opinion INT OUTPUT
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @cuenta INT,@estado NVARCHAR(50);
  IF @calificacion NOT BETWEEN 1 AND 5 THROW 50070,'La calificación debe estar entre 1 y 5.',1;
  SELECT @cuenta=r.id_cuenta_cliente,@estado=e.nombre FROM dbo.Reservaciones r JOIN dbo.EstadosReservacion e ON e.id=r.id_estado_reservacion WHERE r.id=@id_reservacion;
  IF @cuenta IS NULL THROW 50071,'La reservación no existe.',1;
  IF @cuenta<>@id_cuenta_cliente THROW 50072,'La reservación no pertenece a este cliente.',1;
  IF @estado<>N'Finalizada' THROW 50073,'Solo se puede opinar sobre reservaciones finalizadas.',1;
  IF EXISTS(SELECT 1 FROM dbo.Opiniones WHERE id_reservacion=@id_reservacion) THROW 50074,'Esta reservación ya tiene una opinión registrada.',1;
  INSERT dbo.Opiniones(id_reservacion,calificacion,comentario) VALUES(@id_reservacion,@calificacion,@comentario);
  SET @id_opinion=CONVERT(INT,SCOPE_IDENTITY());
END;
GO
/* Módulos administrativos adicionales. Datos externos se marcan como revisión manual. */
IF OBJECT_ID('dbo.UbicacionesGPS','U') IS NULL
BEGIN
  CREATE TABLE dbo.UbicacionesGPS(
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    id_vehiculo INT NOT NULL REFERENCES dbo.Vehiculos(id),
    latitud DECIMAL(9,6) NOT NULL,
    longitud DECIMAL(9,6) NOT NULL,
    fecha DATETIME2 NOT NULL CONSTRAINT DF_UbicacionesGPS_fecha DEFAULT SYSDATETIME(),
    fuente NVARCHAR(30) NOT NULL CONSTRAINT DF_UbicacionesGPS_fuente DEFAULT N'Manual/demo',
    registrado_por INT NULL REFERENCES dbo.CuentasCliente(id),
    CONSTRAINT CK_UbicacionesGPS_latitud CHECK(latitud BETWEEN -90 AND 90),
    CONSTRAINT CK_UbicacionesGPS_longitud CHECK(longitud BETWEEN -180 AND 180)
  );
END;
GO
IF OBJECT_ID('dbo.EvaluacionesCliente','U') IS NULL
BEGIN
  CREATE TABLE dbo.EvaluacionesCliente(
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    id_cliente INT NOT NULL REFERENCES dbo.CuentasCliente(id),
    id_administrador INT NOT NULL REFERENCES dbo.CuentasCliente(id),
    id_reservacion INT NULL REFERENCES dbo.Reservaciones(id),
    calificacion TINYINT NOT NULL,
    categoria NVARCHAR(40) NOT NULL,
    comentario NVARCHAR(1000) NOT NULL,
    fecha DATETIME2 NOT NULL CONSTRAINT DF_EvaluacionesCliente_fecha DEFAULT SYSDATETIME(),
    CONSTRAINT CK_EvaluacionesCliente_calificacion CHECK(calificacion BETWEEN 1 AND 5)
  );
END;
GO
IF OBJECT_ID('dbo.PropuestasPropietario','U') IS NULL
BEGIN
  CREATE TABLE dbo.PropuestasPropietario(
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    nombre NVARCHAR(100) NOT NULL,
    correo NVARCHAR(150) NOT NULL,
    telefono NVARCHAR(20) NOT NULL,
    marca NVARCHAR(60) NOT NULL,
    modelo NVARCHAR(80) NOT NULL,
    anio SMALLINT NOT NULL,
    placa NVARCHAR(20) NOT NULL,
    tarifa_sugerida DECIMAL(10,2) NOT NULL,
    estado NVARCHAR(20) NOT NULL CONSTRAINT DF_PropuestasPropietario_estado DEFAULT N'Pendiente',
    porcentaje_propietario DECIMAL(5,2) NOT NULL CONSTRAINT DF_PropuestasPropietario_porcentaje DEFAULT 70,
    nota_admin NVARCHAR(1000) NULL,
    creado DATETIME2 NOT NULL CONSTRAINT DF_PropuestasPropietario_creado DEFAULT SYSDATETIME(),
    CONSTRAINT CK_PropuestasPropietario_estado CHECK(estado IN(N'Pendiente',N'En revisión',N'Aceptada',N'Rechazada')),
    CONSTRAINT CK_PropuestasPropietario_porcentaje CHECK(porcentaje_propietario BETWEEN 0 AND 100),
    CONSTRAINT CK_PropuestasPropietario_tarifa CHECK(tarifa_sugerida >= 0)
  );
END;
GO
IF OBJECT_ID('dbo.VerificacionesDocumentales','U') IS NULL
BEGIN
  CREATE TABLE dbo.VerificacionesDocumentales(
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    id_cliente INT NULL REFERENCES dbo.CuentasCliente(id),
    id_vehiculo INT NULL REFERENCES dbo.Vehiculos(id),
    tipo NVARCHAR(20) NOT NULL,
    estado NVARCHAR(20) NOT NULL CONSTRAINT DF_VerificacionesDocumentales_estado DEFAULT N'Pendiente',
    nota NVARCHAR(1000) NULL,
    revisado_por INT NULL REFERENCES dbo.CuentasCliente(id),
    revisado_en DATETIME2 NULL,
    creado DATETIME2 NOT NULL CONSTRAINT DF_VerificacionesDocumentales_creado DEFAULT SYSDATETIME(),
    CONSTRAINT CK_VerificacionesDocumentales_tipo CHECK(tipo IN(N'Licencia',N'Placas')),
    CONSTRAINT CK_VerificacionesDocumentales_estado CHECK(estado IN(N'Pendiente',N'Revisado manualmente',N'Requiere corrección')),
    CONSTRAINT CK_VerificacionesDocumentales_objeto CHECK(id_cliente IS NOT NULL OR id_vehiculo IS NOT NULL)
  );
END;
GO
IF OBJECT_ID('dbo.SolicitudesFactura','U') IS NULL
BEGIN
  CREATE TABLE dbo.SolicitudesFactura(
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    id_reservacion INT NOT NULL REFERENCES dbo.Reservaciones(id),
    id_cliente INT NOT NULL REFERENCES dbo.CuentasCliente(id),
    rfc NVARCHAR(13) NOT NULL,
    razon_social NVARCHAR(160) NOT NULL,
    codigo_postal NVARCHAR(5) NOT NULL,
    regimen_fiscal NVARCHAR(10) NOT NULL,
    uso_cfdi NVARCHAR(10) NOT NULL,
    correo NVARCHAR(150) NOT NULL,
    estado NVARCHAR(30) NOT NULL CONSTRAINT DF_SolicitudesFactura_estado DEFAULT N'Pendiente de timbrado',
    creado DATETIME2 NOT NULL CONSTRAINT DF_SolicitudesFactura_creado DEFAULT SYSDATETIME()
  );
END;
GO
CREATE OR ALTER PROCEDURE dbo.sp_RegistrarUbicacionGPS
  @id_vehiculo INT,@latitud DECIMAL(9,6),@longitud DECIMAL(9,6),@registrado_por INT
AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS(SELECT 1 FROM dbo.Vehiculos WHERE id=@id_vehiculo AND ISNULL(retirado,0)=0)
    THROW 50201,'El vehículo no existe o fue retirado.',1;
  IF @latitud NOT BETWEEN -90 AND 90 OR @longitud NOT BETWEEN -180 AND 180
    THROW 50202,'Las coordenadas están fuera de rango.',1;
  INSERT dbo.UbicacionesGPS(id_vehiculo,latitud,longitud,registrado_por)
  VALUES(@id_vehiculo,@latitud,@longitud,@registrado_por);
END;
GO

IF COL_LENGTH('dbo.CuentasCliente','correo_verificado') IS NULL
BEGIN
  ALTER TABLE dbo.CuentasCliente ADD correo_verificado BIT NOT NULL
    CONSTRAINT DF_CuentasCliente_correo_verificado DEFAULT(0) WITH VALUES;
END;
GO
IF OBJECT_ID('dbo.VerificacionCorreo','U') IS NULL
BEGIN
  CREATE TABLE dbo.VerificacionCorreo(
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    id_cliente INT NOT NULL REFERENCES dbo.CuentasCliente(id) ON DELETE CASCADE,
    token_hash VARBINARY(32) NOT NULL,
    expira DATETIME2 NOT NULL,
    creado DATETIME2 NOT NULL CONSTRAINT DF_VerificacionCorreo_creado DEFAULT SYSDATETIME()
  );
  CREATE INDEX IX_VerificacionCorreo_cliente ON dbo.VerificacionCorreo(id_cliente);
END;
GO

/* Normaliza Opiniones: cliente y vehículo se consultan desde Reservaciones. */
IF COL_LENGTH('dbo.Opiniones','id_cuenta_cliente') IS NOT NULL
BEGIN
  EXEC(N'UPDATE o SET id_cuenta_cliente=r.id_cuenta_cliente,id_vehiculo=r.id_vehiculo FROM dbo.Opiniones o JOIN dbo.Reservaciones r ON r.id=o.id_reservacion;');
  DECLARE @dropOpinionFK NVARCHAR(MAX)=N'';
  SELECT @dropOpinionFK=@dropOpinionFK+N'ALTER TABLE dbo.Opiniones DROP CONSTRAINT '+QUOTENAME(fk.name)+N';'
  FROM sys.foreign_keys fk
  JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id=fk.object_id
  JOIN sys.columns col ON col.object_id=fkc.parent_object_id AND col.column_id=fkc.parent_column_id
  WHERE fk.parent_object_id=OBJECT_ID(N'dbo.Opiniones') AND col.name IN(N'id_cuenta_cliente',N'id_vehiculo');
  IF @dropOpinionFK<>N'' EXEC sys.sp_executesql @dropOpinionFK;
  EXEC(N'ALTER TABLE dbo.Opiniones DROP COLUMN id_cuenta_cliente,id_vehiculo;');
END;
GO
CREATE OR ALTER PROCEDURE dbo.sp_RegistrarOpinion
  @id_cuenta_cliente INT,@id_reservacion INT,@calificacion TINYINT,
  @comentario NVARCHAR(MAX)=NULL,@id_opinion INT OUTPUT
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @cuenta INT,@estado NVARCHAR(50);
  IF @calificacion NOT BETWEEN 1 AND 5 THROW 50070,'La calificación debe estar entre 1 y 5.',1;
  SELECT @cuenta=r.id_cuenta_cliente,@estado=e.nombre FROM dbo.Reservaciones r JOIN dbo.EstadosReservacion e ON e.id=r.id_estado_reservacion WHERE r.id=@id_reservacion;
  IF @cuenta IS NULL THROW 50071,'La reservación no existe.',1;
  IF @cuenta<>@id_cuenta_cliente THROW 50072,'La reservación no pertenece a este cliente.',1;
  IF @estado<>N'Finalizada' THROW 50073,'Solo se puede opinar sobre reservaciones finalizadas.',1;
  IF EXISTS(SELECT 1 FROM dbo.Opiniones WHERE id_reservacion=@id_reservacion) THROW 50074,'Esta reservación ya tiene una opinión registrada.',1;
  INSERT dbo.Opiniones(id_reservacion,calificacion,comentario) VALUES(@id_reservacion,@calificacion,@comentario);
  SET @id_opinion=CONVERT(INT,SCOPE_IDENTITY());
END;
GO
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.Opiniones') AND name=N'UX_Opiniones_reservacion')
   AND NOT EXISTS(SELECT id_reservacion FROM dbo.Opiniones WHERE id_reservacion IS NOT NULL GROUP BY id_reservacion HAVING COUNT(*)>1)
  CREATE UNIQUE INDEX UX_Opiniones_reservacion ON dbo.Opiniones(id_reservacion) WHERE id_reservacion IS NOT NULL;
GO
/* CRUD académico por entidad: CREATE, READ, UPDATE y DELETE.
   Los nombres y tipos se validan contra el esquema; las FK siguen protegiendo los datos. */
CREATE OR ALTER PROCEDURE dbo.usp_CRUD_Tabla
  @tabla SYSNAME,
  @accion VARCHAR(10),
  @id BIGINT = NULL,
  @datos NVARCHAR(MAX) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  IF @tabla NOT IN (N'CategoriasVehiculo',N'EstadosPago',N'EstadosReservacion',N'EstadosVehiculo',N'MetodosPago',N'Roles',N'Sucursales',N'CuentasCliente',N'Vehiculos',N'Mantenimientos',N'Reservaciones',N'Pagos',N'Opiniones',N'BitacoraErrores',N'BitacoraAuditoria',N'UbicacionesGPS',N'EvaluacionesCliente',N'PropuestasPropietario',N'VerificacionesDocumentales',N'SolicitudesFactura',N'VerificacionCorreo')
    THROW 50301, 'Tabla fuera de la lista CRUD permitida.', 1;
  IF OBJECT_ID(N'dbo.'+@tabla,N'U') IS NULL
    THROW 50302, 'La tabla indicada no existe en dbo.', 1;
  IF @accion NOT IN ('CREATE','READ','UPDATE','DELETE')
    THROW 50303, 'Acción no válida. Usa CREATE, READ, UPDATE o DELETE.', 1;

  DECLARE @obj INT=OBJECT_ID(N'dbo.'+@tabla,N'U'), @sql NVARCHAR(MAX), @cols NVARCHAR(MAX), @vals NVARCHAR(MAX), @sets NVARCHAR(MAX), @read NVARCHAR(MAX);
  SELECT @read=STRING_AGG(CONVERT(NVARCHAR(MAX),QUOTENAME(name)),N',')
  FROM sys.columns WHERE object_id=@obj AND name NOT IN (N'contrasena',N'token_hash');

  IF @accion='READ'
  BEGIN
    SET @sql=N'SELECT '+@read+N' FROM dbo.'+QUOTENAME(@tabla)+CASE WHEN @id IS NULL THEN N' ORDER BY id;' ELSE N' WHERE id=@id;' END;
    EXEC sys.sp_executesql @sql,N'@id BIGINT',@id=@id;
    RETURN;
  END;
  IF @accion='DELETE'
  BEGIN
    IF @id IS NULL THROW 50304, 'Para DELETE debes indicar @id.', 1;
    SET @sql=N'DELETE dbo.'+QUOTENAME(@tabla)+N' WHERE id=@id; IF @@ROWCOUNT=0 THROW 50305, ''No existe el registro indicado.'', 1;';
    EXEC sys.sp_executesql @sql,N'@id BIGINT',@id=@id;
    RETURN;
  END;
  IF ISJSON(@datos)<>1 THROW 50306, 'Para CREATE/UPDATE envía @datos como objeto JSON válido.', 1;

  SELECT
    @cols=STRING_AGG(CONVERT(NVARCHAR(MAX),QUOTENAME(c.name)),N','),
    @vals=STRING_AGG(CONVERT(NVARCHAR(MAX),N'TRY_CONVERT('+
      CASE WHEN t.name IN(N'nvarchar',N'nchar') THEN t.name+N'('+CASE WHEN c.max_length=-1 THEN N'max' ELSE CONVERT(NVARCHAR(10),c.max_length/2) END+N')'
           WHEN t.name IN(N'varchar',N'char',N'varbinary',N'binary') THEN t.name+N'('+CASE WHEN c.max_length=-1 THEN N'max' ELSE CONVERT(NVARCHAR(10),c.max_length) END+N')'
           WHEN t.name IN(N'decimal',N'numeric') THEN t.name+N'('+CONVERT(NVARCHAR(10),c.precision)+N','+CONVERT(NVARCHAR(10),c.scale)+N')'
           ELSE t.name END+N',(SELECT TOP(1) [value] FROM OPENJSON(@datos) WHERE [key]=N'''+REPLACE(c.name,N'''',N'''''')+N'''))'),N','),
    @sets=STRING_AGG(CONVERT(NVARCHAR(MAX),QUOTENAME(c.name)+N'=TRY_CONVERT('+
      CASE WHEN t.name IN(N'nvarchar',N'nchar') THEN t.name+N'('+CASE WHEN c.max_length=-1 THEN N'max' ELSE CONVERT(NVARCHAR(10),c.max_length/2) END+N')'
           WHEN t.name IN(N'varchar',N'char',N'varbinary',N'binary') THEN t.name+N'('+CASE WHEN c.max_length=-1 THEN N'max' ELSE CONVERT(NVARCHAR(10),c.max_length) END+N')'
           WHEN t.name IN(N'decimal',N'numeric') THEN t.name+N'('+CONVERT(NVARCHAR(10),c.precision)+N','+CONVERT(NVARCHAR(10),c.scale)+N')'
           ELSE t.name END+N',(SELECT TOP(1) [value] FROM OPENJSON(@datos) WHERE [key]=N'''+REPLACE(c.name,N'''',N'''''')+N'''))'),N',')
  FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id
  WHERE c.object_id=@obj AND c.is_identity=0 AND c.is_computed=0
    AND EXISTS(SELECT 1 FROM OPENJSON(@datos) j WHERE j.[key] COLLATE DATABASE_DEFAULT=c.name COLLATE DATABASE_DEFAULT);

  IF @accion='CREATE'
  BEGIN
    IF @cols IS NULL THROW 50307, 'No hay campos editables en el JSON.', 1;
    SET @sql=N'INSERT dbo.'+QUOTENAME(@tabla)+N'('+@cols+N') OUTPUT inserted.id AS id SELECT '+@vals+N';';
  END
  ELSE
  BEGIN
    IF @id IS NULL THROW 50308, 'Para UPDATE debes indicar @id.', 1;
    IF @sets IS NULL THROW 50309, 'No hay campos actualizables en el JSON.', 1;
    SET @sql=N'UPDATE dbo.'+QUOTENAME(@tabla)+N' SET '+@sets+N' WHERE id=@id; IF @@ROWCOUNT=0 THROW 50305, ''No existe el registro indicado.'', 1;';
  END;
  EXEC sys.sp_executesql @sql,N'@datos NVARCHAR(MAX),@id BIGINT',@datos=@datos,@id=@id;
END;
GO

/* Un procedimiento CRUD con nombre propio por cada tabla de la aplicación. */
DECLARE @tablas TABLE(nombre SYSNAME PRIMARY KEY);
INSERT @tablas(nombre) VALUES
(N'CategoriasVehiculo'),(N'EstadosPago'),(N'EstadosReservacion'),(N'EstadosVehiculo'),(N'MetodosPago'),(N'Roles'),(N'Sucursales'),(N'CuentasCliente'),(N'Vehiculos'),(N'Mantenimientos'),(N'Reservaciones'),(N'Pagos'),(N'Opiniones'),(N'BitacoraErrores'),(N'BitacoraAuditoria'),(N'UbicacionesGPS'),(N'EvaluacionesCliente'),(N'PropuestasPropietario'),(N'VerificacionesDocumentales'),(N'SolicitudesFactura'),(N'VerificacionCorreo');
DECLARE @tabla SYSNAME,@wrapper NVARCHAR(MAX);
WHILE EXISTS(SELECT 1 FROM @tablas)
BEGIN
  SELECT TOP(1) @tabla=nombre FROM @tablas ORDER BY nombre;
  IF OBJECT_ID(N'dbo.'+@tabla,N'U') IS NOT NULL
  BEGIN
    SET @wrapper=N'CREATE OR ALTER PROCEDURE dbo.'+QUOTENAME(N'usp_CRUD_'+@tabla)+N' @accion VARCHAR(10),@id BIGINT=NULL,@datos NVARCHAR(MAX)=NULL AS BEGIN SET NOCOUNT ON; EXEC dbo.usp_CRUD_Tabla @tabla=N'''+REPLACE(@tabla,N'''',N'''''')+N''',@accion=@accion,@id=@id,@datos=@datos; END;';
    EXEC sys.sp_executesql @wrapper;
  END;
  DELETE @tablas WHERE nombre=@tabla;
END;
GO