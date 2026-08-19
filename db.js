require('dotenv').config();
const { Pool } = require('pg');

process.env.TZ = 'America/Managua';


let poolConfig;

if (process.env.NODE_ENV === 'production') {
    console.log('🔧 Configurando para PRODUCCIÓN con Transaction Pooler...');
    
    poolConfig = {
        host: process.env.PGHOST || 'aws-0-us-west-2.pooler.supabase.com',
        user: process.env.PGUSER || 'postgres.rdqvgmsutnbrsuezcgfw',
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE || 'postgres',
        port: parseInt(process.env.PGPORT) || 6543,  
        ssl: {
            rejectUnauthorized: false
        },
        family: 4,  // FORZAR IPv4
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
        max: 10,
       options: '-c timezone=America/Managua'

    };
} else {
    console.log('🔧 Configurando para LOCAL...');
    poolConfig = {
        host: process.env.PGHOST || 'localhost',
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || 'Odvin123',
        database: process.env.PGDATABASE || 'InvenSaaS',
        port: process.env.PGPORT || 5432,
        ssl: false,
      options: '-c timezone=America/Managua'

    };
}

console.log('📋 Configuración final:', {
    host: poolConfig.host,
    user: poolConfig.user,
    database: poolConfig.database,
    port: poolConfig.port,
    ssl: !!poolConfig.ssl,
    family: poolConfig.family || 'default',
     timezone: 'America/Managua' 
});

const pool = new Pool(poolConfig);

pool.on('connect', () => {
 console.log('✅ Conectado a la base de datos');
    client.query('SET timezone TO "America/Managua"', (err) => {
        if (err) {
            console.error('❌ Error al configurar timezone:', err);
        } else {
            console.log('✅ Zona horaria configurada: America/Managua');
        }
    });});

pool.on('error', (err) => {
    console.error('❌ Error en la conexión:', err);
});

async function verificarZonaHoraria() {
    try {
        const result = await pool.query('SHOW timezone');
        console.log('🕐 Zona horaria de la base de datos:', result.rows[0].TimeZone);
        return result.rows[0].TimeZone;
    } catch (error) {
        console.error('❌ Error al verificar timezone:', error);
        return null;
    }
}

verificarZonaHoraria();


const query = (text, params) => pool.query(text, params);
const getClient = () => pool.connect();

module.exports = {
    query,
    getClient,
    verificarZonaHoraria
};