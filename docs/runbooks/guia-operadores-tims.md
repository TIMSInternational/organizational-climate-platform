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
- Para dar de alta a un compañero de TIMS: en **Empresas**, abra **TIMS International** →
  **Usuarios** → **Invitar persona**. Cuando acepte la invitación y elija su contraseña, abra su
  ficha y cambie el **Rol** a **Super administrador**. Queda con el mismo acceso que cualquier
  otro super administrador. **Nunca lo invite desde la empresa de un cliente**: quedaría contado
  entre la gente de ese cliente, y dentro de su audiencia si se le asigna un departamento.
- En **Configuración del Sistema** hay dos interruptores que afectan a **todos los clientes a la
  vez**: **Inicio de sesión habilitado** (apagado, nadie entra salvo los super administradores) y
  **Modo de mantenimiento**. No se tocan mientras haya una encuesta abierta.

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

## Un cliente nuevo

1. **Empresas → Nueva empresa.** La lista de Empresas dice el **idioma** de cada una. El dominio es el del correo del cliente y no se puede repetir:
   quien se registre con ese dominio entra a esta empresa. Al crearla, la plataforma lo lleva a la
   empresa con una lista de **Primeros pasos**.
2. **Antes de crear la primera encuesta**, decida en la empresa el **Acceso de los participantes**
   (una cuenta para todas las encuestas, o un código por encuesta). Cada encuesta se queda con el
   modo con que se creó.
3. **Marca**: en la empresa, **Subir logotipo** (PNG, JPG o WebP, hasta 512 KB). Se guarda al
   instante y sale en las pantallas y en los correos de acceso. Un SVG no se acepta.
4. **Plantillas**: en el asistente de nueva encuesta, cada plantilla dice de qué empresa es
   («Instrumento de clima · ESPH») o si es **Global**. Use la del cliente o una global, nunca la
   de otro cliente.
5. **Importar Excel integral** (en Todas las encuestas) carga de una vez los campos demográficos,
   las personas y la encuesta como borrador. Revise la pantalla de revisión: dice qué correos se
   enviarán y cuándo, antes de crear nada.
6. **Que la audiencia sea exactamente la lista del cliente:** en la audiencia de la encuesta elija
   **Personas específicas** y pegue los correos de la lista del cliente. La pantalla dice cuáles no
   están en la empresa o están inactivos. Así nadie que el cliente no nombró puede recibir nada.
7. **Participantes previstos**: si lo deja en blanco, la tasa de respuesta se calcula sobre la
   audiencia que eligió (la pantalla dice cuántas personas son).
8. **Encuesta por QR o enlace que debe abrir antes de su fecha de inicio**: en Distribución, active
   **Abrir el enlace antes de la fecha de inicio**. Una encuesta activa no deja mover su inicio.
9. **Informes para el cliente**: en Empresas → la empresa → Informes, elija **la encuesta** del
   informe. «Todas las encuestas de la empresa» las junta en un solo documento.

## Lo de todos los días

### "No le llegó el correo a fulano"

En la encuesta, abra **Distribución** y busque a la persona en la lista. La barra superior se pone
sola en la empresa de esa encuesta. El botón de su fila ya le dice qué hacer:

| Lo que muestra la fila | Botón | Qué hace |
|---|---|---|
| No tiene código (nunca se le envió, o se le retiró) | **Enviar código** | Usuario y contraseña **solo para esa persona**: nadie más recibe correo. Úselo solo si el cliente la nombró por escrito |
| Tiene código y nunca entró | **Reenviar credenciales** | Mismo usuario, contraseña nueva; la anterior deja de servir |
| Entró pero no terminó | **Enviar recordatorio** (u **Enviar otro recordatorio**) | Un correo sin contraseña nueva: ya la tiene |
| Ya terminó | — | Nada que enviar |
| Hay que dársela en persona (papel, el correo de su empresa la rechaza, o el cliente pidió pasársela él) | **Entregar en mano** (solo superadministrador) | Contraseña nueva que se muestra **una sola vez** en pantalla; no se envía correo. Sirve también si ya había entrado y la perdió: sus respuestas guardadas se conservan |

- **Nunca use «Enviar códigos» para una sola persona**: ese botón le escribe a todas las de la
  audiencia que todavía no tienen código, también a las que el cliente no puso en su lista.
- La fila dice cuándo se envió el código y si ya se le recordó. La página de la encuesta dice
  cuántos recordatorios se han enviado en total.
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

En el mismo cuadro elija el **Formato**:

- **Completo**: todas las columnas de la lista (usuario, código, estado, última actividad).
- **Avance (formato ESPH)**: *Nombre completo*, *Porcentaje de Avance* (100 %, 0 % o «En curso»)
  y *Observaciones* (Finalizada, Pendiente Finalizar, Sin Iniciar), la fila entera coloreada y el
  total de finalizadas abajo. El nombre va **en una sola columna**, tal como está guardado: no
  se separan los apellidos, porque separarlos sería adivinar.

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
