USE MexicoRuns2;
GO
SET NOCOUNT ON;

SELECT N'Tablas de la aplicación' AS comprobacion,
       COUNT(*) AS cantidad
FROM sys.tables
WHERE is_ms_shipped=0 AND name<>N'sysdiagrams';

SELECT N'Relaciones de clave foránea' AS comprobacion,
       COUNT(*) AS cantidad
FROM sys.foreign_keys
WHERE is_ms_shipped=0;

SELECT N'Procedimientos CRUD por tabla' AS comprobacion,
       COUNT(*) AS cantidad
FROM sys.procedures
WHERE name LIKE N'usp_CRUD[_]%' AND name<>N'usp_CRUD_Tabla';

SELECT t.name AS tabla_sin_procedimiento_crud
FROM sys.tables t
WHERE t.is_ms_shipped=0 AND t.name<>N'sysdiagrams'
  AND NOT EXISTS(SELECT 1 FROM sys.procedures p WHERE p.name=N'usp_CRUD_'+t.name)
ORDER BY t.name;

SELECT id,nombre,ciudad,estado
FROM dbo.Sucursales
ORDER BY nombre;

SELECT COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA=N'dbo' AND TABLE_NAME=N'Opiniones'
ORDER BY ORDINAL_POSITION;

SELECT name AS procedimiento_crud
FROM sys.procedures
WHERE name LIKE N'usp_CRUD[_]%' AND name<>N'usp_CRUD_Tabla'
ORDER BY name;
GO