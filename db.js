require('dotenv').config();
const { Pool } = require('pg');

let poolConfig;

if (process.env.NODE_ENV === 'production') {
    console.log('🔧 Configurando para PRODUCCIÓN...');
    console.log('📌 Usando variables separadas:');
    console.log('   Host:', process.env.PGHOST);
    console.log('   User:', process.env.PGUSER);
    console.log('   Database:', process.env.PGDATABASE);
    console.log('   Port:', process.env.PGPORT);
    
    poolConfig = {
        host: process.env.PGHOST,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE,
        port: parseInt(process.env.PGPORT) || 5432,
        ssl: {
            rejectUnauthorized: false
        },
        family: 4,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
        max: 10,
    };
} else {
    console.log('🔧 Configurando para LOCAL...');
    poolConfig = {
        host: process.env.PGHOST || 'localhost',
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || 'Odvin123',
        database: process.env.PGDATABASE || 'InvenSaaS',
        port: process.env.PGPORT || 5432,
        ssl: false
    };
}

console.log('📋 Configuración final:', {
    host: poolConfig.host,
    user: poolConfig.user,
    database: poolConfig.database,
    port: poolConfig.port,
    ssl: !!poolConfig.ssl,
    family: poolConfig.family || 'default'
});

const pool = new Pool(poolConfig);

pool.on('connect', () => {
    console.log('✅ Conectado a la base de datos');
});

pool.on('error', (err) => {
    console.error('❌ Error en la conexión:', err);
});

const query = (text, params) => pool.query(text, params);
const getClient = () => pool.connect();

module.exports = {
    query,
    getClient,
};