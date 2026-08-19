require('dotenv').config();
process.env.TZ = 'America/Managua';
console.log('🕐 Zona horaria configurada:', process.env.TZ);
console.log('🕐 Hora actual en Nicaragua:', new Date().toLocaleString('es-NI', { timeZone: 'America/Managua' }));
console.log('🕐 Hora UTC:', new Date().toISOString());
const express = require('express');
const { loginLimiter } = require('./middleware/rateLimiter');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const cors = require('cors');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const movimientosRouter = require('./routes/movimientos');
console.log('=====================================');
console.log('🔍 DIAGNÓSTICO DE CONEXIÓN:');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PGHOST:', process.env.PGHOST);
console.log('PGUSER:', process.env.PGUSER);
console.log('PGDATABASE:', process.env.PGDATABASE);
console.log('PGPORT:', process.env.PGPORT);
console.log('DATABASE_URL existe?', !!process.env.DATABASE_URL);
console.log('=====================================');

const db = require('./db');

(async () => {
    try {
        console.log('🔌 Probando conexión a la base de datos...');
        const testResult = await db.query('SELECT NOW() as time, version() as version');
        console.log('✅ CONEXIÓN EXITOSA:');
        console.log('   Hora:', testResult.rows[0].time);
        console.log('   Versión:', testResult.rows[0].version);
    } catch (error) {
        console.error('❌ ERROR DE CONEXIÓN:');
        console.error('   Mensaje:', error.message);
        console.error('   Código:', error.code);
        console.error('   Detalles:', error.detail || 'No disponible');
    }
})();
console.log('✅ db importado correctamente');

// IMPORTACIÓN DE MIDDLEWARES
const { verifyToken } = require('./middleware/auth');
const { setTenant } = require('./middleware/setTenant');

const app = express();

const port = process.env.PORT || 10000;

// IMPORTACIÓN DE RUTAS MODULARES
const proveedoresRouter = require('./routes/proveedores');
const categoriasRouter = require('./routes/Categorias');
const productosRouter = require('./routes/productos');
const ventasRouter = require('./routes/ventas');
const clientesRouter = require('./routes/clientes');
const vendedoresRouter = require('./routes/vendedores');
const entradasRouter = require('./routes/entradas');


// Configuración del servicio de correo
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_SERVICE_HOST,
    port: parseInt(process.env.EMAIL_SERVICE_PORT) || 465,
    secure: parseInt(process.env.EMAIL_SERVICE_PORT) === 465 ? true : false,
    auth: {
        user: process.env.EMAIL_SERVICE_USER,
        pass: process.env.EMAIL_SERVICE_PASS
    },
    tls: {
        rejectUnauthorized: false
    },
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000
});

// Funciones auxiliares
function generateSixDigitCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateSecureToken() {
    return crypto.randomBytes(32).toString('hex');
}

function generateRandomPassword(length = 12) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

app.use(cors({
    origin: [
        'https://invensaas-sistema.vercel.app', 
        'https://sistema-inventario-gilt.vercel.app',
        'http://localhost:5500',
        'http://127.0.0.1:5500'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());


app.get('/', (req, res) => {
    res.json({ message: 'API de Inventario SaaS en funcionamiento.' });
});

app.get('/api', (req, res) => {
    res.json({ message: 'API de Inventario SaaS en funcionamiento.' });
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});
// RUTAS MODULARES
app.use('/api/admin/proveedores', verifyToken, setTenant, proveedoresRouter);
app.use('/api/admin/categorias', verifyToken, setTenant, categoriasRouter);
app.use('/api/admin/productos', verifyToken, setTenant, productosRouter);
app.use('/api/admin/ventas', verifyToken, setTenant, ventasRouter);
app.use('/api/admin/clientes', verifyToken, setTenant, clientesRouter);
app.use('/api/admin/vendedores', verifyToken, setTenant, vendedoresRouter);
app.use('/api/admin/inventario/entradas', verifyToken, setTenant, entradasRouter);
app.use('/api/admin/inventario/movimientos', verifyToken, setTenant, movimientosRouter);    
app.use('/api/admin/cortes', verifyToken, setTenant, require('./routes/cortes'))
// ============================================
// RUTAS DE AUTENTICACIÓN
// ============================================

app.get('/api/test-timezone', verifyToken, async (req, res) => {
    const now = new Date();
    
    let dbTimezone = 'No verificada';
    try {
        const result = await db.query('SHOW timezone');
        dbTimezone = result.rows[0].TimeZone;
    } catch (error) {
        console.error('Error al verificar timezone en DB:', error);
    }
    
    res.json({
        success: true,
        data: {
            server_time_utc: now.toISOString(),
            server_time_nicaragua: now.toLocaleString('es-NI', { timeZone: 'America/Managua' }),
            server_timezone: process.env.TZ,
            database_timezone: dbTimezone,
            tenant_id: req.usuario?.tenant_id || 'No disponible'
        }
    });
});

app.get('/api/check-tenant/:tenantId', async (req, res) => {
    const { tenantId } = req.params;
    if (!tenantId) {
        return res.status(400).json({ exists: false, message: 'Tenant ID es obligatorio.' });
    }
    try {
        const result = await db.query(
            'SELECT tenant_id FROM empresas WHERE tenant_id = $1',
            [tenantId]
        );
        if (result.rowCount > 0) {
            return res.json({ exists: true, message: 'El Tenant ID ya está en uso.' });
        } else {
            return res.json({ exists: false, message: 'Tenant ID disponible.' });
        }
    } catch (error) {
        console.error('Error al verificar Tenant ID:', error);
        res.status(500).json({ exists: false, message: 'Error interno del servidor.' });
    }
});

app.post('/api/solicitar-reset-pw', async (req, res) => {
    console.log('🔍 === RECUPERACIÓN DE CONTRASEÑA ===');
    const { tenant_id, correo_electronico } = req.body;
    console.log('📌 Tenant:', tenant_id);
    console.log('📌 Email:', correo_electronico);

    if (!tenant_id || !correo_electronico) {
        return res.status(400).json({ success: false, message: 'Faltan campos obligatorios.' });
    }

    try {
        // 1. Verificar que el usuario existe
        const userResult = await db.query(
            `SELECT u.id, u.nombre, e.nombre_empresa 
             FROM usuarios u 
             JOIN empresas e ON u.empresa_id = e.id 
             WHERE LOWER(u.correo_electronico) = LOWER($1) AND LOWER(e.tenant_id) = LOWER($2)`,
            [correo_electronico, tenant_id]
        );

        if (userResult.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Credenciales de acceso no encontradas.' });
        }

        const { id: usuarioId, nombre, nombre_empresa } = userResult.rows[0];
        const tokenCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expirationTime = new Date(Date.now() + 15 * 60 * 1000);

        // 2. Guardar en la base de datos
        const client = await db.getClient();
        try {
            await client.query('BEGIN');
            await client.query(
                'UPDATE password_resets SET usado = TRUE WHERE usuario_id = $1 AND expira_en > NOW() AND usado = FALSE',
                [usuarioId]
            );
            await client.query(
                'INSERT INTO password_resets (usuario_id, token_code, expira_en) VALUES ($1, $2, $3)',
                [usuarioId, tokenCode, expirationTime]
            );
            await client.query('COMMIT');
        } catch (dbError) {
            await client.query('ROLLBACK');
            throw dbError;
        } finally {
            client.release();
        }

        // 3. Enviar correo (MANEJO DE ERRORES SIMPLE)
        const mailOptions = {
            from: `"Soporte InvenSaaS" <${process.env.EMAIL_SERVICE_USER}>`,
            to: correo_electronico,
            subject: `🔐 Código de Recuperación - ${nombre_empresa}`,
            html: `
                <h2>Recuperación de Contraseña</h2>
                <p>Hola <strong>${nombre}</strong>,</p>
                <p>Tu código de seguridad es:</p>
                <h1 style="background:#f0f0f0; padding:15px; text-align:center; border-radius:8px; font-size:32px; letter-spacing:4px;">${tokenCode}</h1>
                <p>Este código expira en <strong>15 minutos</strong>.</p>
                <p>Si no solicitaste esto, ignora este mensaje.</p>
            `
        };

        try {
            await transporter.sendMail(mailOptions);
            console.log('✅ Correo enviado a:', correo_electronico);
        } catch (mailError) {
            console.error('❌ Error al enviar correo:', mailError.message);
            // No detenemos el flujo, solo registramos el error
        }

        res.status(200).json({
            success: true,
            message: 'Código de seguridad enviado a su correo electrónico.'
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor.'
        });
    }
});


app.post('/api/validar-reset-code', async (req, res) => {
    const { tenant_id, correo_electronico, token_code } = req.body;

    if (!tenant_id || !correo_electronico || !token_code) {
        return res.status(400).json({ success: false, message: 'Faltan campos obligatorios.' });
    }

    try {
        const result = await db.query(
            `SELECT pr.id AS reset_id, pr.expira_en
             FROM password_resets pr
             JOIN usuarios u ON pr.usuario_id = u.id
             JOIN empresas e ON u.empresa_id = e.id
             WHERE u.correo_electronico = $1 AND e.tenant_id = $2 AND pr.token_code = $3 
               AND pr.usado = FALSE AND pr.expira_en > NOW()
             ORDER BY pr.fecha_creacion DESC LIMIT 1`, 
            [correo_electronico, tenant_id, token_code]
        );

        if (result.rowCount === 0) {
            return res.status(401).json({ success: false, message: 'Código inválido, expirado o ya utilizado.' });
        }
        
        const resetData = result.rows[0];
        
        const resetToken = generateSecureToken();
        const secureTokenExpiration = new Date(Date.now() + 5 * 60 * 1000); 

        await db.query(
            `UPDATE password_resets 
             SET usado = TRUE, secure_token = $1, secure_token_expira_en = $2
             WHERE id = $3`,
            [resetToken, secureTokenExpiration, resetData.reset_id]
        );

        res.status(200).json({ 
            success: true, 
            message: 'Código verificado con éxito.', 
            resetToken: resetToken 
        });

    } catch (error) {
        console.error('Error al verificar token:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
});


app.post('/api/finalizar-reset-pw', async (req, res) => {
    const { resetToken, newPassword } = req.body;
    
    if (!resetToken || !newPassword) {
        return res.status(400).json({ success: false, message: 'Faltan campos obligatorios.' });
    }
    

    const passwordValid = newPassword.length >= 8 && newPassword.length <= 12 && 
                          /\d/.test(newPassword) && /[A-Z]/.test(newPassword) && 
                          !/[^a-zA-Z0-9]/.test(newPassword);

    if (!passwordValid) {
        return res.status(400).json({ success: false, message: 'La contraseña no cumple los requisitos de seguridad.' });
    }

    try {
        const resetResult = await db.query(
            `SELECT pr.usuario_id, e.tenant_id
             FROM password_resets pr
             JOIN usuarios u ON pr.usuario_id = u.id
             JOIN empresas e ON u.empresa_id = e.id
             WHERE pr.secure_token = $1 
               AND pr.secure_token_expira_en > NOW()`, 
            [resetToken]
        );

        if (resetResult.rowCount === 0) {
            return res.status(401).json({ success: false, message: 'Token de restablecimiento inválido o expirado. Vuelva a empezar.' });
        }

        const { usuario_id, tenant_id } = resetResult.rows[0];
        const newPasswordHash = await bcrypt.hash(newPassword, 10);
        
        await db.query(
            `UPDATE usuarios 
             SET password_hash = $1, necesita_cambio_pw = FALSE 
             WHERE id = $2`,
            [newPasswordHash, usuario_id]
        );

        await db.query(
            'UPDATE password_resets SET secure_token_expira_en = NOW() WHERE secure_token = $1',
            [resetToken]
        );

        res.status(200).json({ 
            success: true, 
            message: 'Contraseña actualizada correctamente.',
            tenant_id: tenant_id 
        });

    } catch (error) {
        console.error('Error al finalizar el restablecimiento de contraseña:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
});

//Cambio de Contraseña Forzado
app.post('/api/cambio-pw-forzado', async (req, res) => {
    const { tenant_id, correo_electronico, new_password } = req.body;

    if (!tenant_id || !correo_electronico || !new_password) {
        return res.status(400).json({ success: false, message: 'Faltan campos obligatorios.' });
    }
    try {
        const userResult = await db.query(
            `SELECT u.id 
             FROM usuarios u 
             JOIN empresas e ON u.empresa_id = e.id 
             WHERE u.correo_electronico = $1 
             AND e.tenant_id = $2 
             AND u.necesita_cambio_pw = TRUE`, 
            [correo_electronico, tenant_id]
        );
        if (userResult.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Solicitud de cambio inválida o ya procesada.' });
        }
        
        const userId = userResult.rows[0].id;
        const newPasswordHash = await bcrypt.hash(new_password, 10);

        await db.query(
            `UPDATE usuarios 
             SET password_hash = $1, necesita_cambio_pw = FALSE 
             WHERE id = $2`,
            [newPasswordHash, userId]
        );

        res.status(200).json({ success: true, message: 'Contraseña actualizada correctamente. Inicie sesión.' });

    } catch (error) {
        console.error('Error al cambiar contraseña forzado:', error);
        res.status(500).json({ success: false, message: 'Error interno.' });
    }
});
//Registros y Login de los Usuarios (CON LOWER para email Y tenant)
app.post('/api/login', loginLimiter, async (req, res) => {
    const { tenant_id, correo_electronico, password } = req.body;

    console.log('🔐 ===== INTENTO DE LOGIN =====');
    console.log('📧 Tenant ID:', tenant_id);
    console.log('📧 Email:', correo_electronico);
    console.log('🔑 Password recibida:', password ? '✅ Sí (oculta)' : '❌ No');

    if (!tenant_id || !correo_electronico || !password) {
        console.log('❌ Faltan credenciales');
        return res.status(400).json({ success: false, message: 'Faltan credenciales.' });
    }

    try {
        console.log('📡 Consultando base de datos...');
        console.log('   - Buscando email:', correo_electronico);
        console.log('   - Buscando tenant:', tenant_id);
        
        // 🔥 USAR LOWER() PARA AMBOS (email Y tenant_id)
        const result = await db.query(
            `SELECT u.*, e.tenant_id, e.id AS empresa_id
             FROM usuarios u
             JOIN empresas e ON u.empresa_id = e.id
             WHERE LOWER(u.correo_electronico) = LOWER($1) 
               AND LOWER(e.tenant_id) = LOWER($2)`,
            [correo_electronico, tenant_id]
        );

        console.log('📊 Resultado de la consulta:');
        console.log('   - Filas encontradas:', result.rowCount);

        if (result.rowCount === 0) {
            console.log('❌ Usuario NO encontrado');
            return res.status(401).json({ success: false, message: 'Credenciales inválidas o Tenant ID incorrecto.' });
        }

        const usuario = result.rows[0];
        console.log('✅ Usuario ENCONTRADO:', usuario.correo_electronico);

        const passwordMatch = await bcrypt.compare(password, usuario.password_hash);
        console.log('   - ¿Contraseña coincide?', passwordMatch ? '✅ SÍ' : '❌ NO');

        if (!passwordMatch) {
            console.log('❌ Contraseña incorrecta');
            return res.status(401).json({ success: false, message: 'Credenciales inválidas o Tenant ID incorrecto.' });
        }
        
        console.log('✅ Autenticación exitosa');
        const payload = {
            id: usuario.id,
            tenant_id: usuario.tenant_id, 
            empresa_id: usuario.empresa_id, 
            rol: usuario.rol
        };

        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' });
        console.log('✅ Token generado correctamente');
        
        return res.status(200).json({
            success: true,
            message: 'Autenticación exitosa.',
            token: token, 
            tenant_id: usuario.tenant_id,
            rol: usuario.rol,
            necesitaCambioPw: usuario.necesita_cambio_pw, 
        });

    } catch (error) {
        console.error('❌ Error durante el login:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
});

// token de enlaces de invitacion 
app.post('/api/invitaciones/generar', verifyToken, async (req, res) => {
    if (req.usuario.rol !== 'super_admin') {
        return res.status(403).json({ 
            success: false, 
            message: 'Acción no permitida. Solo SuperAdmin.' 
        });
    }

    const { notas, dias_validez } = req.body;
    const dias = parseInt(dias_validez) || 7; // Por defecto 7 días

    try {
        const token = crypto.randomBytes(32).toString('hex');
        
        const result = await db.query(
            `INSERT INTO invitaciones 
             (token, creado_por, fecha_expiracion, notas) 
             VALUES ($1, $2, NOW() + INTERVAL '${dias} days', $3) 
             RETURNING id, token, fecha_creacion, fecha_expiracion`,
            [token, req.usuario.id, notas || null]
        );

        const baseUrl = process.env.FRONTEND_URL || 'https://invensaas-sistema.vercel.app';
        const enlace = `${baseUrl}/registro_empresa.html?token=${token}`;

        res.status(201).json({
            success: true,
            message: 'Token de invitación generado correctamente.',
            token: token,
            enlace: enlace,
            expira: result.rows[0].fecha_expiracion,
            id: result.rows[0].id
        });

    } catch (error) {
        console.error('Error al generar token:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor.' 
        });
    }
});
//Eliminación de Empresas y todos sus Usuarios
app.delete('/api/empresa/:tenantId', verifyToken, async (req, res) => {
    if (!req.usuario || req.usuario.rol !== 'super_admin') {
        return res.status(403).json({ 
            success: false, 
            message: 'Acción de eliminación no permitida. Solo SuperAdmin.' 
        });
    }

    const { tenantId } = req.params; 
    
    if (tenantId === 'super_admin') {
        return res.status(403).json({ 
            success: false, 
            message: 'Error: El puesto de Administración Central (super_admin) no puede ser eliminado.' 
        });
    }

    console.log('🔍 Eliminando empresa:', tenantId);

    const client = await db.getClient();

    try {
        await client.query('BEGIN');

        const empresaResult = await client.query(
            'SELECT id, nombre_empresa FROM empresas WHERE tenant_id = $1',
            [tenantId]
        );

        if (empresaResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ 
                success: false, 
                message: 'Empresa no encontrada.' 
            });
        }

        const empresaId = empresaResult.rows[0].id;
        const nombreEmpresa = empresaResult.rows[0].nombre_empresa;

        console.log(`✅ Empresa encontrada: ${nombreEmpresa} (ID: ${empresaId})`);


        await client.query(
            'DELETE FROM movimientos_inventario WHERE empresa_id = $1',
            [empresaId]
        );
        console.log('✅ Movimientos eliminados');

        await client.query(
            'DELETE FROM detalle_venta WHERE venta_id IN (SELECT id FROM ventas WHERE empresa_id = $1)',
            [empresaId]
        );
        console.log('✅ Detalles de ventas eliminados');

        await client.query(
            'DELETE FROM pagos_venta WHERE venta_id IN (SELECT id FROM ventas WHERE empresa_id = $1)',
            [empresaId]
        );
        console.log('✅ Pagos eliminados');

        await client.query(
            'DELETE FROM ventas WHERE empresa_id = $1',
            [empresaId]
        );
        console.log('✅ Ventas eliminadas');

        await client.query(
            'DELETE FROM productos WHERE empresa_id = $1',
            [empresaId]
        );
        console.log('✅ Productos eliminados');

        await client.query(
            'DELETE FROM proveedores WHERE empresa_id = $1',
            [empresaId]
        );
        console.log('✅ Proveedores eliminados');

        await client.query(
            'DELETE FROM categorias WHERE empresa_id = $1',
            [empresaId]
        );
        console.log('✅ Categorías eliminadas');

        await client.query(
            'DELETE FROM clientes WHERE empresa_id = $1',
            [empresaId]
        );
        console.log('✅ Clientes eliminados');

        await client.query(
            'DELETE FROM vendedores WHERE empresa_id = $1',
            [empresaId]
        );
        console.log('✅ Vendedores eliminados');

        await client.query(
            'DELETE FROM control_folios WHERE empresa_id = $1',
            [empresaId]
        );
        console.log('✅ Control folios eliminado');

        await client.query(
            'DELETE FROM password_resets WHERE usuario_id IN (SELECT id FROM usuarios WHERE empresa_id = $1)',
            [empresaId]
        );
        console.log('✅ Password resets eliminados');

        await client.query(
            'DELETE FROM usuarios WHERE empresa_id = $1',
            [empresaId]
        );
        console.log('✅ Usuarios eliminados');

        await client.query(
            'DELETE FROM empresas WHERE id = $1',
            [empresaId]
        );
        console.log('✅ Empresa eliminada');

        await client.query('COMMIT');

        res.status(200).json({
            success: true,
            message: `La empresa '${nombreEmpresa}' (${tenantId}) y todos sus datos han sido eliminados correctamente.`,
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error al eliminar empresa:', error);
        console.error('   - Mensaje:', error.message);
        console.error('   - Código:', error.code);
        console.error('   - Detalle:', error.detail);
        
        res.status(500).json({ 
            success: false, 
            message: `Error al eliminar la empresa: ${error.message}` 
        });
    } finally {
        client.release();
    }
});

//Registro de Nuevas Empresas y Administradores 
app.post('/api/register', async (req, res) => {
    const { tenant_id, nombre_empresa, nombre_admin, correo_electronico, password, forzar_cambio_pw, token } = req.body;
    
    if (!token) {
        return res.status(400).json({ 
            success: false, 
            message: 'Se requiere un token de invitación válido para registrarse.' 
        });
    }

    const emailRegex = /^[^\s@]+@(gmail\.com|outlook\.com|yahoo\.com|icloud\.com)$/i;

    if (!emailRegex.test(correo_electronico)) {
        return res.status(400).json({ 
            success: false, 
            message: 'El formato de correo es inválido o el dominio no está permitido.' 
        });
    }

    let tokenValido = false;
    let tokenId = null;

    try {
        const tokenResult = await db.query(
            `SELECT id, usado, fecha_expiracion 
             FROM invitaciones 
             WHERE token = $1 AND usado = FALSE AND fecha_expiracion > NOW()`,
            [token]
        );

        if (tokenResult.rowCount === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'El enlace de invitación no es válido, ya fue usado o ha expirado.' 
            });
        }

        tokenValido = true;
        tokenId = tokenResult.rows[0].id;

    } catch (error) {
        console.error('Error al validar token:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Error al validar el enlace de invitación.' 
        });
    }

    if (!tokenValido) {
        return res.status(400).json({ 
            success: false, 
            message: 'Token de invitación inválido.' 
        });
    }

    const necesitaCambioPw = forzar_cambio_pw === false ? false : true; 
    
    const client = await db.getClient();
    let empresaId; 

    try {
        await client.query('BEGIN');
        
        const empresaResult = await client.query(
            'INSERT INTO empresas (tenant_id, nombre_empresa, activo) VALUES ($1, $2, TRUE) RETURNING id',
            [tenant_id, nombre_empresa]
        );
        
        empresaId = empresaResult.rows[0].id; 
        const passwordHash = await bcrypt.hash(password, 10);

        await client.query(
            `INSERT INTO usuarios 
             (empresa_id, nombre, correo_electronico, password_hash, rol, necesita_cambio_pw) 
             VALUES ($1, $2, $3, $4, $5, $6)`, 
            [empresaId, nombre_admin, correo_electronico, passwordHash, 'administrador', necesitaCambioPw] 
        );

        await client.query(
            'UPDATE invitaciones SET usado = TRUE, empresa_creada_id = $1, fecha_uso = NOW() WHERE id = $2',
            [empresaId, tokenId]
        );

        await client.query('COMMIT');

        res.status(201).json({
            success: true,
            message: 'Empresa y administrador principal creados exitosamente.',
            tenant_id: tenant_id
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error FATAL durante la transacción:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor al crear empresa.' 
        });
        
    } finally {
        client.release();
    }
});


app.get('/api/invitaciones', verifyToken, async (req, res) => {
    if (req.usuario.rol !== 'super_admin') {
        return res.status(403).json({ 
            success: false, 
            message: 'Acción no permitida. Solo SuperAdmin.' 
        });
    }

    try {
        const result = await db.query(
            `SELECT i.*, u.nombre AS creador_nombre 
             FROM invitaciones i
             LEFT JOIN usuarios u ON i.creado_por = u.id
             ORDER BY i.fecha_creacion DESC
             LIMIT 50`
        );

        res.status(200).json({
            success: true,
            invitaciones: result.rows
        });
    } catch (error) {
        console.error('Error al listar invitaciones:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor.' 
        });
    }
});

app.get('/api/check-email/:email', async (req, res) => {
    const { email } = req.params;
    
    if (!email) {
        return res.status(400).json({ exists: false, message: 'Correo es obligatorio.' });
    }

    try {
        const result = await db.query(
            'SELECT id FROM usuarios WHERE correo_electronico = $1',
            [email]
        );
        
        if (result.rowCount > 0) {
            return res.json({ exists: true, message: 'El correo ya está registrado.' });
        } else {
            return res.json({ exists: false, message: 'Correo disponible.' });
        }
    } catch (error) {
        console.error('Error al verificar correo:', error);
        res.status(500).json({ exists: false, message: 'Error interno del servidor.' });
    }
});

// Listado de Empresas para SuperAdmin
app.get('/api/admin/empresas', verifyToken, async (req, res) => { 
    if (req.usuario.rol !== 'super_admin') {
        return res.status(403).json({ success: false, message: 'Acción no permitida para este rol.' });
    }
    
    try {
        const result = await db.query(`
            SELECT 
                e.id, 
                e.tenant_id, 
                e.nombre_empresa, 
                e.activo, 
                e.fecha_registro,
                (SELECT u.correo_electronico FROM usuarios u WHERE u.empresa_id = e.id AND u.rol = 'administrador' LIMIT 1) AS admin_email
            FROM 
                empresas e
            ORDER BY 
                e.id ASC
        `);
        return res.status(200).json({ success: true, empresas: result.rows });
    } catch (error) {
        console.error('Error al listar empresas:', error);
        res.status(500).json({ success: false, message: 'Error interno al cargar datos.' });
    }
});

//Resetear Contraseña de Administrador por SuperAdmin
app.post('/api/admin/reset-pw', verifyToken, async (req, res) => {
    const { tenant_id, correo_electronico, new_password } = req.body;
    if (req.usuario.rol !== 'super_admin') {
        return res.status(403).json({ success: false, message: 'Acción no permitida para este rol.' });
    }
    
    let passwordToHash = new_password;
    let generatedPassword = null;
    
    if (new_password === 'GENERAR_ALEATORIA') {
        generatedPassword = generateRandomPassword();
        passwordToHash = generatedPassword;
    } else if (new_password.length < 6) {
        return res.status(400).json({ success: false, message: 'La contraseña temporal debe tener al menos 6 caracteres.' });
    }

    try {
        const userResult = await db.query(
            `SELECT u.id, e.nombre_empresa
             FROM usuarios u 
             JOIN empresas e ON u.empresa_id = e.id 
             WHERE u.correo_electronico = $1 
             AND e.tenant_id = $2 
             AND u.rol = 'administrador'`, 
            [correo_electronico, tenant_id]
        );

        if (userResult.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Administrador no encontrado para este Puesto/Empresa.' });
        }
        
        const userId = userResult.rows[0].id;
        const nombreEmpresa = userResult.rows[0].nombre_empresa;

        const newPasswordHash = await bcrypt.hash(passwordToHash, 10);

        await db.query(
            `UPDATE usuarios 
             SET password_hash = $1, necesita_cambio_pw = TRUE 
             WHERE id = $2`,
            [newPasswordHash, userId]
        );
        
        const resetLink = `http://localhost:5500/frontend/login.html?tenant=${tenant_id}`;

        await transporter.sendMail({
            from: `"Soporte Central SaaS" <${process.env.EMAIL_SERVICE_USER}>`,
            to: correo_electronico, 
            subject: `⚠️ Aviso de Reseteo de Contraseña - ${nombreEmpresa}`,
            html: `
                <p>Estimado Administrador de <b>${nombreEmpresa}</b> (${tenant_id}),</p>
                <p>Su contraseña ha sido restablecida por un SuperAdmin.</p>
                <p>Para acceder al sistema debe usar la siguiente contraseña temporal y será <b>forzado a cambiarla</b> inmediatamente:</p>
                <h3 style="background-color: #f0f0f0; padding: 10px; border: 1px solid #ccc;">Contraseña Temporal: <strong>${passwordToHash}</strong></h3>
                <p>Use este enlace para acceder:</p>
                <a href="${resetLink}" style="padding: 10px 15px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Ir a Iniciar Sesión</a>
                <p style="margin-top: 20px; color: #dc3545;">*Por favor, cambie su contraseña lo antes posible por una de su elección.*</p>
            `,
        });

        const responseMessage = generatedPassword 
            ? `Contraseña aleatoria generada y enviada a ${correo_electronico}.` 
            : `Contraseña manual establecida y enviada a ${correo_electronico}.`;

        res.status(200).json({ 
            success: true, 
            message: responseMessage,
            generatedPassword: generatedPassword 
        });

    } catch (error) {
        console.error('Error FATAL al resetear contraseña o enviar correo:', error);
        res.status(500).json({ success: false, message: 'Error interno al procesar el reseteo y/o enviar el correo.' });
    }
});


app.listen(port, () => {
    console.log(`Backend API escuchando en http://localhost:${port}`);
});