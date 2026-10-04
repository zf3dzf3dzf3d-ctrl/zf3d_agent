const sql = require('mssql');
const Database = require('better-sqlite3');

async function main() {
    console.log('Connecting to LocalDB zf3ddate_old...');
    const pool = await sql.connect({
        server: 'localhost',
        database: 'zf3ddate_old',
        options: { trustServerCertificate: true, enableArithAbort: true, instanceName: 'MSSQLLocalDB' }
    });
    console.log('Connected');

    const sqliteDb = new Database('C:/work/web/data/zf3d.db');
    sqliteDb.pragma('journal_mode = WAL');

    // Build user ID map
    console.log('Building user ID map...');
    const userResult = await pool.request().query('SELECT user_id, username FROM Tx_User');
    const userIdMap = new Map();
    for (const row of userResult.recordset) {
        const sqliteUser = sqliteDb.prepare('SELECT user_id FROM users WHERE username = ?').get(row.username);
        if (sqliteUser) userIdMap.set(Number(row.user_id), sqliteUser.user_id);
    }
    console.log(`Mapped ${userIdMap.size} users`);

    // Migrate recruitment (zp_zwyq -> posts board 200)
    console.log('Migrating zp_zwyq...');
    let zpCount = 0;
    const zpResult = await pool.request().query('SELECT id, user_id, zwbt, zwms, data FROM zp_zwyq ORDER BY id ASC');
    const insertZp = sqliteDb.prepare('INSERT INTO posts (board_id, title, content, user_id, created_at) VALUES (200, ?, ?, ?, ?)');
    for (const row of zpResult.recordset) {
        const title = (row.zwbt || '').trim();
        if (!title) continue;
        const newUserId = userIdMap.get(Number(row.user_id) || 0) || 0;
        let date = new Date().toISOString().replace('T',' ').substring(0,19);
        if (row.data) { try { date = new Date(row.data).toISOString().replace('T',' ').substring(0,19); } catch(e){} }
        insertZp.run(title, row.zwms || '', newUserId, date);
        zpCount++;
    }
    console.log(`Migrated ${zpCount} recruitment records`);

    // Migrate job seeking (rc_grtj -> posts board 201)
    console.log('Migrating rc_grtj...');
    let rcCount = 0;
    const rcResult = await pool.request().query('SELECT id, user_id, title, nr, shijian FROM rc_grtj ORDER BY id ASC');
    const insertRc = sqliteDb.prepare('INSERT INTO posts (board_id, title, content, user_id, created_at) VALUES (201, ?, ?, ?, ?)');
    for (const row of rcResult.recordset) {
        const title = (row.title || '').trim();
        if (!title) continue;
        const newUserId = userIdMap.get(Number(row.user_id) || 0) || 0;
        let date = new Date().toISOString().replace('T',' ').substring(0,19);
        if (row.shijian) { try { date = new Date(row.shijian).toISOString().replace('T',' ').substring(0,19); } catch(e){} }
        insertRc.run(title, row.nr || '', newUserId, date);
        rcCount++;
    }
    console.log(`Migrated ${rcCount} job seeking records`);

    sqliteDb.close();
    await pool.close();
    console.log(`\n=== Done: 招聘=${zpCount}, 求职=${rcCount} ===`);
}

main().catch(e => { console.error(e); process.exit(1); });
