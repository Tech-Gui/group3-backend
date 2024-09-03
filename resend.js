const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

const SendEmail = async function (to, subject, html) {
  return await resend.emails.send({
    from: "Sola <onboarding@resend.dev>",
    to,
    subject,
    html,
  });
};

module.exports = SendEmail;
