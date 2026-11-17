CREATE DATABASE MexicoRuns2;
GO

USE MexicoRuns2;
GO

-- SIN FK
CREATE TABLE CategoriasVehiculo (
    id INT IDENTITY(1,1) PRIMARY KEY,
    nombre NVARCHAR(50),
    descripcion NVARCHAR(250),
    tarifa_diaria DECIMAL(10,2)
);

CREATE TABLE EstadosPago (
    id INT IDENTITY(1,1) PRIMARY KEY,
    nombre NVARCHAR(50),       -- Pendiente, Pagado, Rechazado, Reembolsado
    descripcion NVARCHAR(250)
);

CREATE TABLE EstadosReservacion (
    id INT IDENTITY(1,1) PRIMARY KEY,
    nombre NVARCHAR(50),       -- Pendiente, Confirmada, En curso, Finalizada, Cancelada
    descripcion NVARCHAR(250)
);

CREATE TABLE EstadosVehiculo (
    id INT IDENTITY(1,1) PRIMARY KEY,
    nombre NVARCHAR(50),       -- Disponible, Rentado, En mantenimiento, Fuera de servicio
    descripcion NVARCHAR(250)
);

CREATE TABLE MetodosPago (
    id INT IDENTITY(1,1) PRIMARY KEY,
    nombre NVARCHAR(50),       -- Tarjeta de crédito, Tarjeta de débito, Efectivo, Transferencia
    descripcion NVARCHAR(250)
);

CREATE TABLE Roles (
    id INT IDENTITY(1,1) PRIMARY KEY,
    nombre_rol NVARCHAR(50),
    descripcion NVARCHAR(250),
    permisos NVARCHAR(500)
);

CREATE TABLE Sucursales (
    id INT IDENTITY(1,1) PRIMARY KEY,
    nombre NVARCHAR(100),
    calle NVARCHAR(100),
    avenida NVARCHAR(100),
    codigo_postal NVARCHAR(10),
    numero_ext NVARCHAR(10),
    ciudad NVARCHAR(100),
    colonia_barrio NVARCHAR(100),
    estado NVARCHAR(100),
    telefono NVARCHAR(10)
);

-- Sucursales de ejemplo para las tres ubicaciones del proyecto.
INSERT INTO Sucursales(nombre, ciudad, estado) VALUES
(N'MexicoRuns Tuxtla Centro', N'Tuxtla Gutiérrez', N'Chiapas'),
(N'MexicoRuns Aeropuerto CDMX', N'Ciudad de México', N'Ciudad de México'),
(N'MexicoRuns Cancún Centro', N'Cancún', N'Quintana Roo');

-- CON FK
CREATE TABLE CuentasCliente (
    id INT IDENTITY(1,1) PRIMARY KEY,
    nombre NVARCHAR(50),
    apellido_pat NVARCHAR(50),
    apellido_mat NVARCHAR(50),
    telefono NVARCHAR(10),
    correo NVARCHAR(100) UNIQUE,
    contrasena NVARCHAR(255),
    debe_cambiar_contrasena BIT NOT NULL CONSTRAINT df_cuenta_cambiar_clave DEFAULT (0),
    numero_licencia NVARCHAR(30),
    fecha_registro DATETIME2 DEFAULT SYSDATETIME(),
    id_rol INT,
    CONSTRAINT fk_cuenta_rol FOREIGN KEY (id_rol) REFERENCES Roles(id)
);

CREATE TABLE Vehiculos (
    id INT IDENTITY(1,1) PRIMARY KEY,
    placa NVARCHAR(20) UNIQUE,
    marca NVARCHAR(50),
    modelo NVARCHAR(50),
    anio INT,
    color NVARCHAR(30),
    num_serie NVARCHAR(30) UNIQUE,
    capacidad_pasajeros INT,
    kilometraje DECIMAL(10,2),  -- en kilómetros
    id_categoria INT,
    id_estado_vehiculo INT,
    id_sucursal INT,
    CONSTRAINT fk_vehiculo_categoria FOREIGN KEY (id_categoria) REFERENCES CategoriasVehiculo(id),
    CONSTRAINT fk_vehiculo_estado FOREIGN KEY (id_estado_vehiculo) REFERENCES EstadosVehiculo(id),
    CONSTRAINT fk_vehiculo_sucursal FOREIGN KEY (id_sucursal) REFERENCES Sucursales(id)
);

CREATE TABLE Mantenimientos (
    id INT IDENTITY(1,1) PRIMARY KEY,
    id_vehiculo INT,
    fecha DATETIME2,
    tipo NVARCHAR(50),          -- Preventivo, Correctivo
    descripcion NVARCHAR(MAX),
    costo DECIMAL(10,2),
    kilometraje DECIMAL(10,2),
    CONSTRAINT fk_mantenimiento_vehiculo FOREIGN KEY (id_vehiculo) REFERENCES Vehiculos(id)
);

-- MAS DE 2 FK
CREATE TABLE Reservaciones (
    id INT IDENTITY(1,1) PRIMARY KEY,
    id_cuenta_cliente INT,
    id_vehiculo INT,
    id_sucursal_recogida INT,
    id_sucursal_entrega INT,
    fecha_inicio DATETIME2,
    fecha_fin DATETIME2,
    costo_total DECIMAL(10,2),
    id_estado_reservacion INT,
    CONSTRAINT fk_reservacion_cuenta FOREIGN KEY (id_cuenta_cliente) REFERENCES CuentasCliente(id),
    CONSTRAINT fk_reservacion_vehiculo FOREIGN KEY (id_vehiculo) REFERENCES Vehiculos(id),
    CONSTRAINT fk_reservacion_sucursal_recogida FOREIGN KEY (id_sucursal_recogida) REFERENCES Sucursales(id),
    CONSTRAINT fk_reservacion_sucursal_entrega FOREIGN KEY (id_sucursal_entrega) REFERENCES Sucursales(id),
    CONSTRAINT fk_reservacion_estado FOREIGN KEY (id_estado_reservacion) REFERENCES EstadosReservacion(id)
);

CREATE TABLE Pagos (
    id INT IDENTITY(1,1) PRIMARY KEY,
    id_reservacion INT,
    id_metodo_pago INT,
    id_estado_pago INT,
    monto DECIMAL(10,2),
    fecha_pago DATETIME2,
    referencia NVARCHAR(100),
    CONSTRAINT fk_pago_reservacion FOREIGN KEY (id_reservacion) REFERENCES Reservaciones(id),
    CONSTRAINT fk_pago_metodo FOREIGN KEY (id_metodo_pago) REFERENCES MetodosPago(id),
    CONSTRAINT fk_pago_estado FOREIGN KEY (id_estado_pago) REFERENCES EstadosPago(id)
);

CREATE TABLE Opiniones (
    id INT IDENTITY(1,1) PRIMARY KEY,
    id_reservacion INT NOT NULL UNIQUE,
    calificacion TINYINT CHECK (calificacion BETWEEN 1 AND 5),
    comentario NVARCHAR(MAX),
    fecha DATETIME2 DEFAULT SYSDATETIME(),
    CONSTRAINT fk_opinion_reservacion FOREIGN KEY (id_reservacion) REFERENCES Reservaciones(id)
);
GO
