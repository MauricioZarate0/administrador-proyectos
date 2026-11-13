# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
PWA estática en vanilla JS sin build + Supabase (Postgres, Auth, Storage), alojada en Cloudflare Pages (antes GitHub Pages). Elegido con el dueño: uso en PC y celular desde cualquier lugar.

## Users
Un solo usuario: el dueño, desarrollador freelance en Argentina que mantiene webs y apps de clientes y cobra una cuota mensual por cada una. Lo usa en la PC mientras trabaja y en el celular cuando un cliente le paga (registrar el pago y mandarle el recibo en el momento).

## Product Purpose
Tener a mano el estado de cada proyecto y lo que hay que vigilar (cobros del mes, renovaciones de dominio y hosting), y emitir y guardar un recibo PDF por cada pago. Éxito: nunca olvidar un cobro ni una renovación, y emitir un recibo en segundos desde el celu.

## Operating Context
- Ritmo mensual: cobros alrededor del día de cobro de cada proyecto.
- El recibo se comparte al cliente desde el celular (WhatsApp, mail).
- Monedas: pesos argentinos (ARS) y dólares (USD) según el proyecto; sin impuestos.

## Capabilities and Constraints
- Proyectos con estado (activo, en desarrollo, pausado, finalizado), cliente, URL, cuota, día de cobro, fechas de renovación, notas.
- Pagos con recibo numerado correlativo (R-0001…), PDF guardado en la nube.
- Datos del emisor configurables (nombre, CUIT/DNI, dirección, contacto, logo).
- *Supuesto (no confirmado):* volumen chico, menos de ~30 proyectos.

## Brand Commitments
Ninguno confirmado. Sin logo ni nombre de marca por ahora; el logo del emisor se carga en Ajustes.

## Evidence on Hand
Ninguna. No inventar clientes ni montos reales: los datos de ejemplo se marcan como tales.

## Product Principles
1. Lo urgente primero: lo que hay que cobrar o renovar se ve antes que todo.
2. Registrar un pago es un solo formulario, precargado.
3. El recibo debe verse serio: se lo mandás a un cliente.
4. Igual de cómodo con el pulgar que con el mouse.

## Accessibility & Inclusion
*Supuesto:* WCAG AA, objetivos táctiles de 44px, funciona con modo oscuro del sistema.
