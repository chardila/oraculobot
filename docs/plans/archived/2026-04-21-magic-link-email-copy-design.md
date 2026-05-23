# Magic Link Email Copy Improvement — Design

## Problem

The current magic link email uses Supabase's generic default template:
- Subject: "Magic Link"
- Body: "Follow this link to login: Log In"

This gives users no context about what app they're accessing.

## Approach

Edit the email template directly in the Supabase dashboard (Authentication > Email Templates). No code changes required.

## New Copy

**Subject:**
```
Tu enlace de acceso a OraculoBot ⚽
```

**Body (HTML):**
```html
<p>Hola,</p>

<p>Alguien (probablemente tú) solicitó acceso al bot de predicciones de fútbol OraculoBot.</p>

<p>Haz clic en el botón para entrar:</p>

<p><a href="{{ .ConfirmationURL }}">Entrar a OraculoBot</a></p>

<p>Si no solicitaste este acceso, puedes ignorar este correo.</p>
```

## Notes

- `{{ .ConfirmationURL }}` is the Supabase template variable for the magic link URL.
- The template is edited under: Supabase Dashboard → Authentication → Email Templates → Magic Link.
- Change applies immediately with no deploy needed.
