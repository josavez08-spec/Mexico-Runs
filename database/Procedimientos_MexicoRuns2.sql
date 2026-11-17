USE MexicoRuns2;
GO

/* =====================================================================
   DATOS BASE DE CATÁLOGOS
   Los procedimientos buscan estos estados y roles por nombre.
   Solo se insertan si la tabla está vacía.
   ===================================================================== */
IF NOT EXISTS (SELECT 1 FROM EstadosVehiculo)
    INSERT INTO EstadosVehiculo (nombre, descripcion) VALUES
    ('Disponible', 'Listo para rentarse'),
    ('Rentado', 'Asignado a una reservación activa'),
    ('En mantenimiento', 'En servicio o reparación'),
    ('Fuera de servicio', 'No disponible');

IF NOT EXISTS (SELECT 1 FROM EstadosReservacion)
    INSERT INTO EstadosReservacion (nombre, descripcion) VALUES
    ('Pendiente', 'Creada, en espera de pago completo'),
    ('Confirmada', 'Pago completo recibido'),
    ('Finalizada', 'Vehículo devuelto'),
    ('Cancelada', 'Cancelada por el cliente o la sucursal');

IF NOT EXISTS (SELECT 1 FROM EstadosPago)
    INSERT INTO EstadosPago (nombre, descripcion) VALUES
    ('Pendiente', 'En espera de confirmación'),
    ('Pagado', 'Pago recibido'),
    ('Rechazado', 'Pago no aceptado'),
    ('Reembolsado', 'Pago devuelto al cliente');

IF NOT EXISTS (SELECT 1 FROM MetodosPago)
    INSERT INTO MetodosPago (nombre, descripcion) VALUES
    ('Tarjeta de crédito', NULL),
    ('Tarjeta de débito', NULL),
    ('Efectivo', NULL),
    ('Transferencia', NULL);

IF NOT EXISTS (SELECT 1 FROM Roles)
    INSERT INTO Roles (nombre_rol, descripcion, permisos) VALUES
    ('Cliente', 'Usuario que renta vehículos', 'reservar,pagar,opinar'),
    ('Administrador', 'Gestiona el sistema', 'todos');
GO

/* =====================================================================
   1. REGISTRAR CUENTA DE CLIENTE
   ===================================================================== */
CREATE OR ALTER PROCEDURE sp_RegistrarCuentaCliente
    @nombre NVARCHAR(50),
    @apellido_pat NVARCHAR(50),
    @apellido_mat NVARCHAR(50) = NULL,
    @telefono NVARCHAR(10),
    @correo NVARCHAR(100),
    @contrasena NVARCHAR(255),
    @numero_licencia NVARCHAR(30),
    @id_rol INT = NULL,
    @id_cuenta INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (SELECT 1 FROM CuentasCliente WHERE correo = @correo)
        THROW 50001, 'Ya existe una cuenta con ese correo.', 1;

    -- Si no se indica rol, se asigna "Cliente"
    IF @id_rol IS NULL
        SELECT @id_rol = id FROM Roles WHERE nombre_rol = 'Cliente';

    IF @id_rol IS NULL OR NOT EXISTS (SELECT 1 FROM Roles WHERE id = @id_rol)
        THROW 50002, 'El rol indicado no existe.', 1;

    INSERT INTO CuentasCliente
        (nombre, apellido_pat, apellido_mat, telefono, correo, contrasena, numero_licencia, id_rol, debe_cambiar_contrasena)
    VALUES
        (@nombre, @apellido_pat, @apellido_mat, @telefono, @correo, @contrasena, @numero_licencia, @id_rol, 0);

    SET @id_cuenta = SCOPE_IDENTITY();
END;
GO

/* =====================================================================
   2. CREAR RESERVACIÓN
   Valida disponibilidad, calcula el costo (tarifa de la categoría x días)
   y marca el vehículo como "Rentado".
   ===================================================================== */
CREATE OR ALTER PROCEDURE sp_CrearReservacion
    @id_cuenta_cliente INT,
    @id_vehiculo INT,
    @id_sucursal_recogida INT,
    @id_sucursal_entrega INT,
    @fecha_inicio DATETIME2,
    @fecha_fin DATETIME2,
    @id_reservacion INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @id_disponible INT, @id_rentado INT, @id_pendiente INT;
    DECLARE @tarifa DECIMAL(10,2), @dias INT, @costo DECIMAL(10,2);

    BEGIN TRY
        IF @fecha_fin <= @fecha_inicio
            THROW 50010, 'La fecha de fin debe ser posterior a la fecha de inicio.', 1;
        IF NOT EXISTS (SELECT 1 FROM CuentasCliente WHERE id = @id_cuenta_cliente)
            THROW 50011, 'La cuenta de cliente no existe.', 1;
        IF NOT EXISTS (SELECT 1 FROM Sucursales WHERE id = @id_sucursal_recogida)
           OR NOT EXISTS (SELECT 1 FROM Sucursales WHERE id = @id_sucursal_entrega)
            THROW 50012, 'La sucursal de recogida o de entrega no existe.', 1;

        BEGIN TRANSACTION;

        SELECT @id_disponible = id FROM EstadosVehiculo WHERE nombre = 'Disponible';
        SELECT @id_rentado = id FROM EstadosVehiculo WHERE nombre = 'Rentado';
        SELECT @id_pendiente = id FROM EstadosReservacion WHERE nombre = 'Pendiente';

        -- Bloquea el vehículo para evitar doble reservación
        SELECT @tarifa = c.tarifa_diaria
        FROM Vehiculos v WITH (UPDLOCK, ROWLOCK)
        JOIN CategoriasVehiculo c ON c.id = v.id_categoria
        JOIN EstadosVehiculo ev ON ev.id = v.id_estado_vehiculo
        WHERE v.id = @id_vehiculo AND ev.nombre IN ('Disponible', 'Rentado');

        IF @tarifa IS NULL
            THROW 50013, 'El vehículo no existe, no está disponible o no tiene categoría con tarifa.', 1;

        IF EXISTS (
            SELECT 1 FROM Reservaciones r WITH (UPDLOCK, HOLDLOCK)
            JOIN EstadosReservacion er ON er.id = r.id_estado_reservacion
            WHERE r.id_vehiculo = @id_vehiculo
              AND er.nombre IN ('Pendiente', 'Confirmada', 'En curso')
              AND r.fecha_inicio < @fecha_fin AND r.fecha_fin > @fecha_inicio
        )
            THROW 50016, 'El vehículo ya tiene una reservación en esas fechas. Elige otras fechas o un vehículo distinto.', 1;

        -- Días de renta (se redondea hacia arriba, mínimo 1)
        SET @dias = CEILING(DATEDIFF(MINUTE, @fecha_inicio, @fecha_fin) / 1440.0);
        IF @dias < 1 SET @dias = 1;
        SET @costo = @dias * @tarifa;

        INSERT INTO Reservaciones
            (id_cuenta_cliente, id_vehiculo, id_sucursal_recogida, id_sucursal_entrega,
             fecha_inicio, fecha_fin, costo_total, id_estado_reservacion)
        VALUES
            (@id_cuenta_cliente, @id_vehiculo, @id_sucursal_recogida, @id_sucursal_entrega,
             @fecha_inicio, @fecha_fin, @costo, @id_pendiente);

        SET @id_reservacion = SCOPE_IDENTITY();

        UPDATE Vehiculos SET id_estado_vehiculo = @id_rentado WHERE id = @id_vehiculo;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

/* =====================================================================
   3. REGISTRAR PAGO
   Si lo pagado cubre el costo total, la reservación pasa a "Confirmada".
   ===================================================================== */
CREATE OR ALTER PROCEDURE sp_RegistrarPago
    @id_reservacion INT,
    @id_metodo_pago INT,
    @monto DECIMAL(10,2),
    @referencia NVARCHAR(100) = NULL,
    @id_pago INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @id_pagado INT, @id_pendiente INT, @id_confirmada INT;
    DECLARE @costo DECIMAL(10,2), @estado_actual NVARCHAR(50), @total_pagado DECIMAL(10,2);

    BEGIN TRY
        IF @monto <= 0
            THROW 50020, 'El monto debe ser mayor a cero.', 1;
        IF NOT EXISTS (SELECT 1 FROM MetodosPago WHERE id = @id_metodo_pago)
            THROW 50021, 'El método de pago no existe.', 1;

        SELECT @costo = r.costo_total, @estado_actual = er.nombre
        FROM Reservaciones r
        JOIN EstadosReservacion er ON er.id = r.id_estado_reservacion
        WHERE r.id = @id_reservacion;

        IF @costo IS NULL
            THROW 50022, 'La reservación no existe.', 1;
        IF @estado_actual NOT IN ('Pendiente', 'Confirmada')
            THROW 50023, 'Solo se pueden registrar pagos en reservaciones Pendientes o Confirmadas.', 1;

        BEGIN TRANSACTION;

        SELECT @id_pagado = id FROM EstadosPago WHERE nombre = 'Pagado';
        SELECT @id_confirmada = id FROM EstadosReservacion WHERE nombre = 'Confirmada';

        INSERT INTO Pagos (id_reservacion, id_metodo_pago, id_estado_pago, monto, fecha_pago, referencia)
        VALUES (@id_reservacion, @id_metodo_pago, @id_pagado, @monto, SYSDATETIME(), @referencia);

        SET @id_pago = SCOPE_IDENTITY();

        SELECT @total_pagado = SUM(monto)
        FROM Pagos
        WHERE id_reservacion = @id_reservacion AND id_estado_pago = @id_pagado;

        IF @total_pagado >= @costo AND @estado_actual = 'Pendiente'
            UPDATE Reservaciones SET id_estado_reservacion = @id_confirmada WHERE id = @id_reservacion;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

/* =====================================================================
   4. CANCELAR RESERVACIÓN
   Libera el vehículo y marca como "Reembolsado" los pagos ya recibidos.
   ===================================================================== */
CREATE OR ALTER PROCEDURE sp_CancelarReservacion
    @id_reservacion INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @id_cancelada INT, @id_disponible INT, @id_pagado INT, @id_reembolsado INT;
    DECLARE @id_vehiculo INT, @estado_actual NVARCHAR(50);

    BEGIN TRY
        SELECT @id_vehiculo = r.id_vehiculo, @estado_actual = er.nombre
        FROM Reservaciones r
        JOIN EstadosReservacion er ON er.id = r.id_estado_reservacion
        WHERE r.id = @id_reservacion;

        IF @id_vehiculo IS NULL
            THROW 50030, 'La reservación no existe.', 1;
        IF @estado_actual IN ('Finalizada', 'Cancelada')
            THROW 50031, 'La reservación ya está Finalizada o Cancelada.', 1;

        BEGIN TRANSACTION;

        SELECT @id_cancelada = id FROM EstadosReservacion WHERE nombre = 'Cancelada';
        SELECT @id_disponible = id FROM EstadosVehiculo WHERE nombre = 'Disponible';
        SELECT @id_pagado = id FROM EstadosPago WHERE nombre = 'Pagado';
        SELECT @id_reembolsado = id FROM EstadosPago WHERE nombre = 'Reembolsado';

        UPDATE Reservaciones SET id_estado_reservacion = @id_cancelada WHERE id = @id_reservacion;
        UPDATE Vehiculos SET id_estado_vehiculo = @id_disponible WHERE id = @id_vehiculo;
        UPDATE Pagos SET id_estado_pago = @id_reembolsado
        WHERE id_reservacion = @id_reservacion AND id_estado_pago = @id_pagado;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

/* =====================================================================
   5. FINALIZAR RESERVACIÓN (devolución del vehículo)
   Pasa la reservación a "Finalizada", deja el vehículo "Disponible" en la
   sucursal de entrega y actualiza su kilometraje si se indica.
   ===================================================================== */
CREATE OR ALTER PROCEDURE sp_FinalizarReservacion
    @id_reservacion INT,
    @kilometraje_final DECIMAL(10,2) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @id_finalizada INT, @id_disponible INT;
    DECLARE @id_vehiculo INT, @id_sucursal_entrega INT, @estado_actual NVARCHAR(50);

    BEGIN TRY
        SELECT @id_vehiculo = r.id_vehiculo, @id_sucursal_entrega = r.id_sucursal_entrega,
               @estado_actual = er.nombre
        FROM Reservaciones r
        JOIN EstadosReservacion er ON er.id = r.id_estado_reservacion
        WHERE r.id = @id_reservacion;

        IF @id_vehiculo IS NULL
            THROW 50040, 'La reservación no existe.', 1;
        IF @estado_actual <> 'Confirmada'
            THROW 50041, 'Solo se puede finalizar una reservación Confirmada (con pago completo).', 1;

        BEGIN TRANSACTION;

        SELECT @id_finalizada = id FROM EstadosReservacion WHERE nombre = 'Finalizada';
        SELECT @id_disponible = id FROM EstadosVehiculo WHERE nombre = 'Disponible';

        UPDATE Reservaciones SET id_estado_reservacion = @id_finalizada WHERE id = @id_reservacion;

        UPDATE Vehiculos
        SET id_estado_vehiculo = @id_disponible,
            id_sucursal = @id_sucursal_entrega,
            kilometraje = CASE WHEN @kilometraje_final > kilometraje THEN @kilometraje_final ELSE kilometraje END
        WHERE id = @id_vehiculo;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

/* =====================================================================
   6. REGISTRAR MANTENIMIENTO
   Guarda el mantenimiento y deja el vehículo "En mantenimiento".
   ===================================================================== */
CREATE OR ALTER PROCEDURE sp_RegistrarMantenimiento
    @id_vehiculo INT,
    @tipo NVARCHAR(50),            -- Preventivo, Correctivo
    @descripcion NVARCHAR(MAX),
    @costo DECIMAL(10,2),
    @kilometraje DECIMAL(10,2) = NULL,
    @fecha DATETIME2 = NULL,
    @id_mantenimiento INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @id_en_mantenimiento INT, @estado_actual NVARCHAR(50);

    BEGIN TRY
        SELECT @estado_actual = ev.nombre
        FROM Vehiculos v
        JOIN EstadosVehiculo ev ON ev.id = v.id_estado_vehiculo
        WHERE v.id = @id_vehiculo;

        IF @estado_actual IS NULL
            THROW 50050, 'El vehículo no existe.', 1;
        IF @estado_actual = 'Rentado'
            THROW 50051, 'No se puede registrar mantenimiento a un vehículo Rentado.', 1;
        IF @costo < 0
            THROW 50052, 'El costo no puede ser negativo.', 1;

        BEGIN TRANSACTION;

        SELECT @id_en_mantenimiento = id FROM EstadosVehiculo WHERE nombre = 'En mantenimiento';

        INSERT INTO Mantenimientos (id_vehiculo, fecha, tipo, descripcion, costo, kilometraje)
        VALUES (@id_vehiculo, ISNULL(@fecha, SYSDATETIME()), @tipo, @descripcion, @costo, @kilometraje);

        SET @id_mantenimiento = SCOPE_IDENTITY();

        UPDATE Vehiculos
        SET id_estado_vehiculo = @id_en_mantenimiento,
            kilometraje = CASE WHEN @kilometraje > kilometraje THEN @kilometraje ELSE kilometraje END
        WHERE id = @id_vehiculo;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

/* Complemento: terminar el mantenimiento y devolver el vehículo a "Disponible" */
CREATE OR ALTER PROCEDURE sp_FinalizarMantenimiento
    @id_vehiculo INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @id_disponible INT, @id_en_mantenimiento INT;

    SELECT @id_disponible = id FROM EstadosVehiculo WHERE nombre = 'Disponible';
    SELECT @id_en_mantenimiento = id FROM EstadosVehiculo WHERE nombre = 'En mantenimiento';

    UPDATE Vehiculos
    SET id_estado_vehiculo = @id_disponible
    WHERE id = @id_vehiculo AND id_estado_vehiculo = @id_en_mantenimiento;

    IF @@ROWCOUNT = 0
        THROW 50060, 'El vehículo no existe o no está En mantenimiento.', 1;
END;
GO

/* =====================================================================
   7. REGISTRAR OPINIÓN
   Solo si la reservación es del cliente, está Finalizada y no tiene opinión.
   ===================================================================== */
CREATE OR ALTER PROCEDURE sp_RegistrarOpinion
    @id_cuenta_cliente INT,
    @id_reservacion INT,
    @calificacion TINYINT,
    @comentario NVARCHAR(MAX) = NULL,
    @id_opinion INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @id_cuenta_reserva INT, @estado_actual NVARCHAR(50);
    IF @calificacion NOT BETWEEN 1 AND 5 THROW 50070, 'La calificación debe estar entre 1 y 5.', 1;
    SELECT @id_cuenta_reserva=r.id_cuenta_cliente,@estado_actual=er.nombre
    FROM Reservaciones r JOIN EstadosReservacion er ON er.id=r.id_estado_reservacion
    WHERE r.id=@id_reservacion;
    IF @id_cuenta_reserva IS NULL THROW 50071, 'La reservación no existe.', 1;
    IF @id_cuenta_reserva<>@id_cuenta_cliente THROW 50072, 'La reservación no pertenece a este cliente.', 1;
    IF @estado_actual<>'Finalizada' THROW 50073, 'Solo se puede opinar sobre reservaciones Finalizadas.', 1;
    IF EXISTS(SELECT 1 FROM Opiniones WHERE id_reservacion=@id_reservacion) THROW 50074, 'Esta reservación ya tiene una opinión registrada.', 1;
    INSERT Opiniones(id_reservacion,calificacion,comentario) VALUES(@id_reservacion,@calificacion,@comentario);
    SET @id_opinion=SCOPE_IDENTITY();
END;
GO
/* =====================================================================
   8. CONSULTAS
   ===================================================================== */

-- Vehículos disponibles (de una sucursal o de todas si @id_sucursal es NULL)
CREATE OR ALTER PROCEDURE sp_VehiculosDisponiblesPorSucursal
    @id_sucursal INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT s.nombre AS sucursal, v.id, v.placa, v.marca, v.modelo, v.anio, v.color,
           v.capacidad_pasajeros, v.kilometraje,
           c.nombre AS categoria, c.tarifa_diaria
    FROM Vehiculos v
    JOIN EstadosVehiculo ev ON ev.id = v.id_estado_vehiculo
    JOIN Sucursales s ON s.id = v.id_sucursal
    LEFT JOIN CategoriasVehiculo c ON c.id = v.id_categoria
    WHERE ev.nombre = 'Disponible'
      AND (@id_sucursal IS NULL OR v.id_sucursal = @id_sucursal)
    ORDER BY s.nombre, c.tarifa_diaria;
END;
GO

-- Historial de reservaciones de un cliente
CREATE OR ALTER PROCEDURE sp_HistorialReservacionesCliente
    @id_cuenta_cliente INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT r.id AS id_reservacion,
           v.marca, v.modelo, v.placa,
           sr.nombre AS sucursal_recogida,
           se.nombre AS sucursal_entrega,
           r.fecha_inicio, r.fecha_fin, r.costo_total,
           er.nombre AS estado,
           ISNULL(SUM(CASE WHEN ep.nombre = 'Pagado' THEN p.monto END), 0) AS total_pagado
    FROM Reservaciones r
    JOIN Vehiculos v ON v.id = r.id_vehiculo
    JOIN Sucursales sr ON sr.id = r.id_sucursal_recogida
    JOIN Sucursales se ON se.id = r.id_sucursal_entrega
    JOIN EstadosReservacion er ON er.id = r.id_estado_reservacion
    LEFT JOIN Pagos p ON p.id_reservacion = r.id
    LEFT JOIN EstadosPago ep ON ep.id = p.id_estado_pago
    WHERE r.id_cuenta_cliente = @id_cuenta_cliente
    GROUP BY r.id, v.marca, v.modelo, v.placa, sr.nombre, se.nombre,
             r.fecha_inicio, r.fecha_fin, r.costo_total, er.nombre
    ORDER BY r.fecha_inicio DESC;
END;
GO

-- Ingresos por periodo (pagos con estado "Pagado"), por método de pago y total
CREATE OR ALTER PROCEDURE sp_IngresosPorPeriodo
    @fecha_inicio DATETIME2,
    @fecha_fin DATETIME2
AS
BEGIN
    SET NOCOUNT ON;

    SELECT mp.nombre AS metodo_pago,
           COUNT(*) AS num_pagos,
           SUM(p.monto) AS total_ingresos
    FROM Pagos p
    JOIN EstadosPago ep ON ep.id = p.id_estado_pago
    JOIN MetodosPago mp ON mp.id = p.id_metodo_pago
    WHERE ep.nombre = 'Pagado'
      AND p.fecha_pago >= @fecha_inicio AND p.fecha_pago < @fecha_fin
    GROUP BY mp.nombre
    ORDER BY total_ingresos DESC;

    SELECT ISNULL(SUM(p.monto), 0) AS total_general
    FROM Pagos p
    JOIN EstadosPago ep ON ep.id = p.id_estado_pago
    WHERE ep.nombre = 'Pagado'
      AND p.fecha_pago >= @fecha_inicio AND p.fecha_pago < @fecha_fin;
END;
GO
