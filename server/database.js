'use strict';
const fs=require('node:fs');
const mysql=require('mysql2/promise');

function databaseOptions(env=process.env){
  let config;
  if(env.RIFT_DB_CONFIG){const loaded=JSON.parse(fs.readFileSync(env.RIFT_DB_CONFIG,'utf8'));config={host:loaded.host,port:loaded.port,...loaded.core};}
  else config={host:env.RIFT_DB_HOST,port:Number(env.RIFT_DB_PORT)||3306,database:env.RIFT_DB_NAME,user:env.RIFT_DB_USER,password:env.RIFT_DB_PASSWORD};
  if(!config.host||!config.database||!config.user||!config.password)throw new Error('Database configuration is missing');
  return {...config,ssl:{rejectUnauthorized:true,verifyIdentity:true,...(env.RIFT_DB_CA?{ca:fs.readFileSync(env.RIFT_DB_CA,'utf8')}:{})},connectionLimit:4,waitForConnections:true,queueLimit:30,multipleStatements:false,supportBigNumbers:true,bigNumberStrings:true,connectTimeout:7000,enableKeepAlive:true};
}
async function createDatabase(env=process.env){
  const pool=mysql.createPool(databaseOptions(env));
  const db={async execute(sql,params=[]){const connection=await pool.getConnection();try{await connection.query('SET SESSION TRANSACTION READ ONLY');return await connection.execute({sql,values:params,timeout:10000});}finally{connection.release();}},async end(){await pool.end();}};
  const connection=await pool.getConnection();try{const [rows]=await connection.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");if(!rows[0]?.Value)throw new Error('Database TLS is required');}finally{connection.release();}
  return db;
}
module.exports={createDatabase,databaseOptions};
