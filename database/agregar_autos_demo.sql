/* Mexico Runs: añade dos vehículos demostrativos. Se puede ejecutar más de una vez. */
USE MexicoRuns2;
GO
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  DECLARE @estadoDisponible INT, @categoriaEconomica INT, @categoriaSUV INT, @sucursalCancun INT, @sucursalTuxtla INT;
  SELECT TOP (1) @estadoDisponible=id FROM dbo.EstadosVehiculo WHERE nombre=N'Disponible' ORDER BY id;
  SELECT TOP (1) @categoriaEconomica=id FROM dbo.CategoriasVehiculo WHERE nombre LIKE N'%Econ%' OR nombre LIKE N'%Compact%' ORDER BY CASE WHEN nombre LIKE N'%Econ%' THEN 0 ELSE 1 END,id;
  SELECT TOP (1) @categoriaSUV=id FROM dbo.CategoriasVehiculo WHERE nombre LIKE N'%SUV%' ORDER BY id;
  SELECT TOP (1) @sucursalCancun=id FROM dbo.Sucursales WHERE ciudad LIKE N'%Cancún%' OR ciudad LIKE N'%Cancun%' ORDER BY id;
  SELECT TOP (1) @sucursalTuxtla=id FROM dbo.Sucursales WHERE ciudad LIKE N'%Tuxtla%' ORDER BY id;
  IF @estadoDisponible IS NULL THROW 51000, 'Falta el estado Disponible en EstadosVehiculo.', 1;
  IF @categoriaEconomica IS NULL OR @categoriaSUV IS NULL THROW 51000, 'Falta una categoría Económico/Compacto o SUV en CategoriasVehiculo.', 1;
  IF @sucursalCancun IS NULL SELECT TOP (1) @sucursalCancun=id FROM dbo.Sucursales ORDER BY id;
  IF @sucursalTuxtla IS NULL SELECT TOP (1) @sucursalTuxtla=id FROM dbo.Sucursales ORDER BY id;
  IF @sucursalCancun IS NULL OR @sucursalTuxtla IS NULL THROW 51000, 'Agrega al menos una sucursal antes de ejecutar este script.', 1;
  IF NOT EXISTS (SELECT 1 FROM dbo.Vehiculos WHERE marca=N'Kia' AND modelo=N'Rio' AND anio=2017)
    INSERT dbo.Vehiculos (placa,marca,modelo,anio,color,num_serie,capacidad_pasajeros,kilometraje,id_categoria,id_estado_vehiculo,id_sucursal)
    VALUES (N'DEMO-RIO-17',N'Kia',N'Rio',2017,N'Rojo',N'MRDEMO-KIARIO-2017',5,0,@categoriaEconomica,@estadoDisponible,@sucursalCancun);
  IF NOT EXISTS (SELECT 1 FROM dbo.Vehiculos WHERE marca=N'Hyundai' AND modelo=N'Creta' AND anio=2016)
    INSERT dbo.Vehiculos (placa,marca,modelo,anio,color,num_serie,capacidad_pasajeros,kilometraje,id_categoria,id_estado_vehiculo,id_sucursal)
    VALUES (N'DEMO-CRETA-16',N'Hyundai',N'Creta',2016,N'Blanco',N'MRDEMO-HYUNDAICRETA-2016',5,0,@categoriaSUV,@estadoDisponible,@sucursalTuxtla);
  COMMIT TRANSACTION;
  SELECT id,marca,modelo,anio,capacidad_pasajeros,id_sucursal FROM dbo.Vehiculos WHERE (marca=N'Kia' AND modelo=N'Rio' AND anio=2017) OR (marca=N'Hyundai' AND modelo=N'Creta' AND anio=2016) ORDER BY marca;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
GO