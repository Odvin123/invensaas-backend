require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const cors = require('cors'); 
const nodemailer = require('nodemailer'); 
const jwt = require('jsonwebtoken'); 
const db = require('./db'); 

// IMPORTACIÓN DE MIDDLEWARES
const { verifyToken } = require('./middleware/auth'); 
const { setTenant } = require('./middleware/setTenant'); 

const app = express();
const port = process.env.PORT || 4000;

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
    port: process.env.EMAIL_SERVICE_PORT,
    secure: false, 
    auth: {
        user: process.env.EMAIL_SERVICE_USER,
        pass: process.env.EMAIL_SERVICE_PASS
    }
});

// Funciones auxiliares
function generateSixDigitCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}
// Función para generar un token seguro y aleatorio.
function generateSecureToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Función para generar una contraseña aleatoria y seguras.
function generateRandomPassword(length = 12) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}


// Configuración de CORS para Vercel
app.use(cors({
    origin: [
        'https://sistema-inventario-gilt.vercel.app', // TU DOMINIO DE VERCEL
        'http://localhost:5500',   // Para desarrollo local
        'http://127.0.0.1:5500'    // Otro puerto común de Live Server
    ],
    credentials: true, // Importante si usas cookies o sesiones
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json()); 

app.get('/', (req, res) => {
    res.json({ message: 'API de Inventario SaaS en funcionamiento.' });
});


// RUTAS MODULARES CON AISLAMIENTO (verifyToken, setTenant)
// Todas las rutas de inventario de una empresa deben usar ambos middlewares.
app.use('/api/admin/proveedores', verifyToken, setTenant, proveedoresRouter); 
app.use('/api/admin/categorias', verifyToken, setTenant, categoriasRouter);
app.use('/api/admin/productos', verifyToken, setTenant, productosRouter);
app.use('/api/admin/ventas', verifyToken, setTenant, ventasRouter);
app.use('/api/admin/clientes', verifyToken, setTenant, clientesRouter); 
app.use('/api/admin/vendedores', verifyToken, setTenant, vendedoresRouter);
app.use('/api/admin/inventario/entradas', verifyToken, setTenant, entradasRouter);


// Evitar Duplicados de Tenant ID
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
    const { tenant_id, correo_electronico } = req.body;

    if (!tenant_id || !correo_electronico) {
        return res.status(400).json({ success: false, message: 'Faltan campos obligatorios.' });
    }

    try {
        const userResult = await db.query(
            `SELECT u.id, u.nombre, e.nombre_empresa 
             FROM usuarios u 
             JOIN empresas e ON u.empresa_id = e.id 
             WHERE u.correo_electronico = $1 AND e.tenant_id = $2`,
            [correo_electronico, tenant_id]
        );

        if (userResult.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Credenciales de acceso no encontradas.' });
        }
        
        const { id: usuarioId, nombre, nombre_empresa } = userResult.rows[0];
        const tokenCode = generateSixDigitCode();
        
        //15 minutos de expiración
        const expirationTime = new Date(Date.now() + 15 * 60 * 1000); 

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

        const mailOptions = {
            from: `"Soporte InvenSaaS" <${process.env.EMAIL_SERVICE_USER}`, 
            to: correo_electronico,
            subject: `🔐 Código de Recuperación de Contraseña - ${nombre_empresa}`,
            html: `
                <p>Estimado(a) ${nombre},</p>
                <p>Use el siguiente código de seguridad para continuar con el proceso:</p>
                <h2 style="background-color: #f0f0f0; padding: 15px; border-radius: 8px; text-align: center;">
                    Código de Seguridad: <strong>${tokenCode}</strong>
                </h2>
                <p style="color: #dc3545;">
                    Este código es válido por solo <b>15 minutos</b>.
                </p>
            `,
        };
        
        await transporter.sendMail(mailOptions); 

        res.status(200).json({ 
            success: true, 
            message: 'Código de seguridad enviado a su correo electrónico.' 
        });

    } catch (error) {
        console.error('Error al solicitar restablecimiento de contraseña:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor. Intente de nuevo más tarde.' });
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

//Registros y Login de los Usuarios (Código Corregido)
app.post('/api/login', async (req, res) => {
    const { tenant_id, correo_electronico, password } = req.body;

    if (!tenant_id || !correo_electronico || !password) {
        return res.status(400).json({ success: false, message: 'Faltan credenciales.' });
    }

    try {
        const result = await db.query(
            `SELECT u.*, e.tenant_id, e.id AS empresa_id
             FROM usuarios u
             JOIN empresas e ON u.empresa_id = e.id
             WHERE u.correo_electronico = $1 AND e.tenant_id = $2`,
            [correo_electronico, tenant_id]
        );

        if (result.rowCount === 0) {
            return res.status(401).json({ success: false, message: 'Credenciales inválidas o Tenant ID incorrecto.' });
        }

        const usuario = result.rows[0];

        const passwordMatch = await bcrypt.compare(password, usuario.password_hash); 

        if (!passwordMatch) {
            return res.status(401).json({ success: false, message: 'Credenciales inválidas o Tenant ID incorrecto.' });
        }
        
        const payload = {
            id: usuario.id,
            tenant_id: usuario.tenant_id, 
            empresa_id: usuario.empresa_id, 
            rol: usuario.rol
        };

        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' });
        
        return res.status(200).json({
            success: true,
            message: 'Autenticación exitosa.',
            token: token, 
            tenant_id: usuario.tenant_id,
            rol: usuario.rol,
            necesitaCambioPw: usuario.necesita_cambio_pw, 
        });

    } catch (error) {
        console.error('Error durante el login:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
});

//Eliminación de Empresas y todos sus Usuarios
app.delete('/api/empresa/:tenantId', verifyToken, async (req, res) => {
    if (req.usuario.rol !== 'super_admin') {
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

    try {
        const result = await db.query(
            'DELETE FROM empresas WHERE tenant_id = $1 RETURNING nombre_empresa',
            [tenantId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Empresa no encontrada.' });
        }

        const nombreEmpresaEliminada = result.rows[0].nombre_empresa;

        res.status(200).json({
            success: true,
            message: `La empresa '${nombreEmpresaEliminada}' (ID: ${tenantId}) y todos sus usuarios han sido eliminados correctamente.`,
        });

    } catch (error) {
        console.error('Error al eliminar empresa:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor al eliminar la empresa.' });
    }
});

//Registro de Nuevas Empresas y Administradores
app.post('/api/register', async (req, res) => {
    const { tenant_id, nombre_empresa, nombre_admin, correo_electronico, password, forzar_cambio_pw } = req.body; 
    const emailRegex = /^[^\s@]+@(gmail\.com|outlook\.com|yahoo\.com|icloud\.com)$/i;

    if (!emailRegex.test(correo_electronico)) {
        return res.status(400).json({ 
            success: false, 
            message: 'El formato de correo es inválido o el dominio no está permitido. Solo se aceptan @gmail.com, @outlook.com, @yahoo.com o @icloud.com.' 
        });
    }

    const necesitaCambioPw = forzar_cambio_pw === false ? false : true; 
    
    try {
        const preCheck = await db.query(
            `SELECT 'tenant' AS tipo FROM empresas WHERE tenant_id = $1
             UNION ALL
             SELECT 'email' AS tipo FROM usuarios WHERE correo_electronico = $2`,
            [tenant_id, correo_electronico]
        );

        if (preCheck.rowCount > 0) {
            const tipoConflicto = preCheck.rows[0].tipo;
            let customMessage = '';

            if (tipoConflicto === 'tenant') {
                customMessage = `Error: El ID de Puesto/Empresa (**${tenant_id}**) ya está en uso.`;
            } else if (tipoConflicto === 'email') {
                customMessage = `Error: El Correo Electrónico (**${correo_electronico}**) ya está registrado por otro administrador.`;
            } else {
                customMessage = 'Error de unicidad. Revise Tenant ID o Correo Electrónico.';
            }

            return res.status(409).json({ 
                success: false,
                message: customMessage
            });
        }
    } catch (error) {
        console.error('Error durante la pre-validación:', error);
        return res.status(500).json({ success: false, message: 'Error interno del servidor durante la validación inicial.' });
    }
    
    
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

        await client.query('COMMIT');

        res.status(201).json({
            success: true,
            message: 'Empresa y administrador principal creados exitosamente.',
            tenant_id: tenant_id
        });

    } catch (error) {
        await client.query('ROLLBACK');
        
        console.error('Error FATAL durante la transacción (ROLLBACK ejecutado):', error);
        
        res.status(500).json({ success: false, message: 'Error interno del servidor al crear empresa. (Operación revertida).' });
        
    } finally {
        client.release();
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