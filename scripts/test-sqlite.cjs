const { app } = require('electron')

app.whenReady().then(() => {
  try {
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(':memory:')
    db.exec('create table t(a integer, b text)')
    db.prepare('insert into t values(?,?)').run(1, 'x')
    const rows = db.prepare('select * from t').all()
    const json = db
      .prepare("select json_group_array(json_object('a', a, 'b', b)) as j from t")
      .get()
    console.log('SQLITE_OK', JSON.stringify(rows), String(json.j))
  } catch (error) {
    console.error('SQLITE_FAIL', error && error.stack ? error.stack : error)
    process.exitCode = 1
  }
  app.quit()
})
