# Guía para operadores de TIMS

Para quien atiende a un cliente desde la plataforma, sin desarrollador de por medio.
Escrita el 2 de noviembre de 2026 con lo que la plataforma hace ese día. Si un botón no está
donde dice esta guía, avise antes de buscar otra forma de hacerlo.

## Antes de empezar: su cuenta

- Cada persona de TIMS tiene **su propia cuenta**. Nunca se comparte una contraseña: el registro
  de actividad (`/admin/audit`) dice quién hizo cada cosa, y con una cuenta compartida deja de
  decirlo.
- Su cuenta es de **super administrador** (`docs/decisions/tims-operators-hold-super-admin.md`).
  Eso le deja ver **a todos los clientes**, no solo al que usted atiende. Trate cada empresa como
  si fuera la única.
- Para dar de alta a un compañero: invítelo desde Usuarios y luego cámbiele el rol a super
  administrador en su ficha.

## Las tres reglas que no se negocian

1. **Solo se le escribe a quien el cliente nombró por escrito.** Si el cliente pide reenviar a
   tres personas, se reenvía a esas tres. Si usted cree que hay más personas a las que les falta
   el correo, **se le pregunta al cliente nombrándolas**: no se les envía y se avisa después.
   El 28 de octubre un análisis "evidente" agregó ocho personas a un reenvío de tres. Ninguna
   era de la población de esa encuesta, y una de ellas contestó una encuesta que no le
   correspondía.
2. **La audiencia no es la lista del cliente.** Una encuesta dirigida por departamentos incluye a
   gente que el cliente no puso en su lista (ESPH Clima: audiencia 633, lista 619). Que alguien
   aparezca en la pantalla de Distribución no significa que el cliente lo haya pedido.
3. **Las respuestas son anónimas para el cliente.** Al cliente nunca se le entrega una clave de
   un trabajador, un archivo con respuestas por persona ni la auditoría de envíos. Las palabras
   que alguien escribió en una pregunta abierta no salen nunca, salvo en el archivo de respuestas
   que solo descarga TIMS.

## Lo de todos los días

### "No le llegó el correo a fulano"

En la encuesta, abra **Distribución** y busque a la persona en la lista. El botón de su fila ya
le dice qué hacer:

| Lo que muestra la fila | Botón | Qué hace |
|---|---|---|
| Tiene código y nunca entró | **Reenviar credenciales** | Mismo usuario, contraseña nueva; la anterior deja de servir |
| Entró pero no terminó | **Enviar recordatorio** (u **Enviar otro recordatorio**) | Un correo sin contraseña nueva: ya la tiene |
| Ya terminó | — | Nada que enviar |
| Hay que dársela en persona (papel, el correo de su empresa la rechaza, o el cliente pidió pasársela él) | **Entregar en mano** (solo superadministrador) | Contraseña nueva que se muestra **una sola vez** en pantalla; no se envía correo. Sirve también si ya había entrado y la perdió: sus respuestas guardadas se conservan |

- La fila dice cuándo se envió el código y si ya se le recordó.
- Si el correo **rebotó**, se marcó como spam o se rechazó, la fila lo dice en rojo con la fecha.
  Reenviar a la misma dirección casi siempre rebota otra vez: cambie el correo (con permiso
  escrito del cliente) o use **Entregar en mano**.
- **Entregar en mano** reemplaza la entrega por correo que antes obligaba a cambiar el correo de
  la persona a un buzón de TIMS. Anote o copie la contraseña antes de ocultarla: no se puede
  volver a mostrar. Si se pierde, se genera otra.
- Si la persona usa un correo personal (Gmail, Hotmail), pídale al cliente que la persona revise
  **Spam** y **Promociones**, buscando el remitente `no-reply@timsint.com`, y que use el correo
  **de hoy**.

### Un cuestionario en papel

Decidido el 3 de noviembre de 2026: el papel **queda ligado a la persona**. TIMS lo digita
entrando con la clave de esa persona, así cuenta como Terminó en el estado y su clave queda
usada. Es lo que se hizo con el primer cuestionario en papel de ESPH el 2 de noviembre.

1. Confirme que la persona está en la lista del cliente y que el papel es suyo.
2. En **Distribución**, use **Entregar en mano** en su fila y anote el usuario y la contraseña.
3. Abra una **ventana privada** del navegador y entre ahí con ese usuario. En la misma ventana
   donde usted trabaja, entrar como la persona cierra su propia sesión.
4. Digite las respuestas **tal como están en el papel**, también las abiertas, sin corregir
   nada. **Revise antes de enviar**: una respuesta enviada no se puede cambiar ni volver a
   enviar.
5. Cierre la ventana privada. La fila de la persona debe decir que terminó.

### "Cámbienle el correo a fulano"

1. Confirme que el cliente lo pidió por escrito y que la persona es de esa encuesta.
2. En **Usuarios**, abra su ficha, cambie el correo y guarde. Cambiar el correo **no envía nada**.
3. Vuelva a **Distribución** y use **Reenviar credenciales** para que el código le llegue a la
   dirección nueva.

### El estado para el cliente

En la lista de encuestas, elija la empresa en el filtro y use **Estado de la empresa (Excel)**.
Es una hoja por encuesta, con Terminó en verde, Empezó en naranja y los totales debajo.
Divide entre las personas a las que se les envió código; si alguien de la audiencia no recibió
código, la hoja lo dice en una nota.

### ¿A quién no le llegó?

**Auditoría de envíos (solo TIMS)**, junto al botón anterior. Dice, por encuesta, cuántos
códigos se enviaron, cuántas personas entraron, a cuántas les rebotó el correo y cuántas no han
dado señal. En la segunda hoja aparece cada rebote con la respuesta del servidor y qué hacer.
**Es solo para TIMS: no se le envía al cliente.**
Solo ve rebotes desde que se conectó el aviso de rebotes; la primera hoja dice desde cuándo.

### Las respuestas para el análisis

En la lista de encuestas, en el menú **⋮** de la encuesta:

- **Descargar las respuestas de este clima**: una fila por respuesta, demográficos con su nombre
  real, respuestas coloreadas según la escala. El color se ve en Excel; en la vista previa de
  Mail o del Finder no.
- **Descargar solo los demográficos (sin respuestas)**: la misma lista sin una sola respuesta.
  Es la que se le puede pasar al cliente para revisar demográficos antes del análisis.

## Mientras una encuesta está abierta

- **Se puede**: reenviar, recordar, cambiar correos, agregar una persona, alargar la fecha de
  cierre.
- **Pregunte antes**: cambiar la audiencia, retirar el código de alguien, cambiar textos o
  preguntas. Lo que cambia la experiencia de quien está contestando no se toca sin decisión.
- **Alargue el cierre antes de que pase.** Una encuesta cerrada **no se puede reabrir** desde
  la plataforma; reabrir Eagle el 27 de octubre necesitó a un desarrollador.

## Lo que todavía no hace la plataforma

- **Quitar una respuesta de los resultados**, ni borrar una persona o una empresa.
- **Reabrir una encuesta cerrada.**

Para cualquiera de estas cosas, o si un botón responde con un error que no entiende, escriba
al equipo de desarrollo con el nombre de la encuesta, la persona y una captura. No lo resuelva
por otra vía.
