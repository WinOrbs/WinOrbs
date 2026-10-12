import { Resend } from 'resend';
import { adminAuth } from './firebase-admin-config.js'; // Tu configuración de Admin SDK

const resend = new Resend(process.env.RESEND_API_KEY);

app.post('/api/enviar-correo-recuperacion', async (req, res) => {
  const { email } = req.body;

  try {
    // 1. Generar el enlace oficial de Firebase de forma segura desde el backend
    const enlaceAccion = await adminAuth.generatePasswordResetLink(email);

    // 2. Enviar el correo usando Resend con tu diseño HTML personalizado
    const data = await resend.emails.send({
      from: 'WinOrbs <soporte@tudominio.com>', // O usa onboarding@resend.dev para pruebas
      to: [email],
      subject: 'Recupera tu acceso a WinOrbs',
      html: `
        <div style="background-color: #060a12; color: #f8fafc; padding: 30px; font-family: sans-serif; border-radius: 12px;">
          <h2 style="color: #38bdf8; text-transform: uppercase; letter-spacing: 1px;">Restablecer contraseña</h2>
          <p>Has solicitado restablecer tu contraseña en <strong>WinOrbs</strong>.</p>
          <p>Haz clic en el siguiente botón para continuar:</p>
          <a href="${enlaceAccion}" style="display: inline-block; background: linear-gradient(90deg, #0ea5e9, #38bdf8); color: #041019; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 8px; margin: 20px 0;">Restablecer contraseña</a>
          <p style="color: #94a3b8; font-size: 12px;">Si no solicitaste esto, puedes ignorar este mensaje.</p>
        </div>
      `
    });

    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});