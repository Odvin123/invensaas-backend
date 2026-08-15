const jwt = require('jsonwebtoken'); 

const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Acceso denegado. No se proporcionó Token.' });
    }

    const token = authHeader.split(' ')[1]; 

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // 🔥 ESTABLECER DATOS DEL USUARIO EN req
        req.usuario = decoded;
        
        // 🔥 AGREGAR tenantId Y esSuperAdmin (importante para los reportes)
        req.tenantId = decoded.tenant_id;
        req.esSuperAdmin = decoded.rol === 'super_admin';
        req.empresaId = decoded.empresa_id;

        console.log('🔑 Usuario autenticado:', {
            id: req.usuario.id,
            rol: req.usuario.rol,
            tenantId: req.tenantId,
            esSuperAdmin: req.esSuperAdmin
        });

        next(); 

    } catch (err) {
        return res.status(403).json({ success: false, message: 'Token inválido o expirado.' });
    }
};

const checkRole = (roles) => {
    return (req, res, next) => {
        if (!req.usuario || !roles.includes(req.usuario.rol)) {
            return res.status(403).json({ success: false, message: 'Acceso denegado. Rol no autorizado.' });
        }
        next();
    };
};

module.exports = { verifyToken, checkRole };