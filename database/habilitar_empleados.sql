USE MexicoRuns2;
GO

-- Las cuentas existentes deben renovar su contraseña al siguiente inicio.
-- Las cuentas nuevas quedan exentas porque el registro valida la contraseña fuerte.
IF COL_LENGTH('dbo.CuentasCliente', 'debe_cambiar_contrasena') IS NULL
BEGIN
    ALTER TABLE dbo.CuentasCliente ADD debe_cambiar_contrasena BIT NOT NULL
        CONSTRAINT df_cuenta_cambiar_clave DEFAULT (1) WITH VALUES;
END;
GO

-- Ejecuta una sola vez para habilitar las cuentas de empleado.
IF NOT EXISTS (SELECT 1 FROM Roles WHERE nombre_rol = N'Empleado')
    INSERT INTO Roles (nombre_rol, descripcion, permisos)
    VALUES (N'Empleado', N'Atiende reservaciones y operaciones de sucursal', N'reservaciones,operacion');
GO
