-- attach_old_db.sql
-- 先分离旧的（如果存在）
IF EXISTS (SELECT 1 FROM sys.databases WHERE name = 'zf3d_old')
    EXEC sp_detach_db 'zf3d_old', 'true';
GO
-- 重新挂载（使用原始中文路径）
CREATE DATABASE zf3d_old ON 
    (FILENAME = N'C:\work\web\data\老数据\zf3ddate - 副本 (2).mdf'), 
    (FILENAME = N'C:\work\web\data\老数据\zf3ddate_log - 副本 (2).ldf') 
    FOR ATTACH
GO
