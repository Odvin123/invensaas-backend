require('dotenv').config();
const { Pool } = require('pg');

let poolConfig;

if (process.env.NODE_ENV === 'production') {
    poolConfig = {
        host: process.env.PGHOST,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE,
        port: process.env.PGPORT || 5432,
        ssl: {
            rejectUnauthorized: false  
        },
        max: 20, 
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
    };
} else {
    
    poolConfig = {
        host: process.env.PGHOST || 'localhost',
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || 'Odvin123',
        database: process.env.PGDATABASE || 'InvenSaaS',
        port: process.env.PGPORT || 5432,
        ssl: false, 
    };
}

const pool = new Pool(poolConfig);

// Probar conexión
pool.on('connect', () => {
    console.log('✅ Conectado a la base de datos');
});

pool.on('error', (err) => {
    console.error('❌ Error en la conexión a la base de datos:', err);
});

const query = (text, params) => pool.query(text, params);
const getClient = () => pool.connect();

module.exports = {
    query,
    getClient,
    pool,
};