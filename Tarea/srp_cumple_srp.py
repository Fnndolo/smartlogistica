# -*- coding: utf-8 -*-
# ============================================================
#  PRINCIPIO DE RESPONSABILIDAD UNICA (SRP) - SOLID
#  Contexto: Sistema de Citas Medicas - IS-III FI303290
#  PARTE 2: DISENO QUE CUMPLE EL SRP
# ============================================================
#
#  Cuatro clases, cada una con UNA sola responsabilidad:
#    CitaMedica       -> logica de negocio (dominio)
#    CitaRepository   -> persistencia en BD
#    EmailNotificador -> notificaciones por correo
#    SMSNotificador   -> notificaciones por SMS
#
#  Cada clase tiene UNA sola razon para cambiar.
# ============================================================

print("=" * 60)
print("  [OK] DISENO QUE CUMPLE EL SRP")
print("=" * 60)
print()


# ------------------------------------------------------------
#  Clase 1: SOLO logica de negocio
#  Razon para cambiar: las reglas de negocio del dominio
# ------------------------------------------------------------
class CitaMedica:
    """
    [OK] Responsabilidad unica: logica de negocio de una cita.
    No sabe nada de BD ni de notificaciones.
    """

    def __init__(self, id_cita, paciente, medico, fecha, hora):
        self.id_cita  = id_cita
        self.paciente = paciente
        self.medico   = medico
        self.fecha    = fecha
        self.hora     = hora
        self.estado   = "PENDIENTE"
        self.motivo_cancelacion = None

    def confirmar(self):
        """Cambia SOLO si las reglas de confirmacion cambian."""
        if self.estado != "PENDIENTE":
            raise ValueError("Solo se pueden confirmar citas PENDIENTES. "
                             "Estado actual: " + self.estado)
        self.estado = "CONFIRMADA"
        print("  [Negocio]  Cita " + self.id_cita + " -> CONFIRMADA")

    def cancelar(self, motivo):
        """Cambia SOLO si las reglas de cancelacion cambian."""
        if self.estado == "CANCELADA":
            raise ValueError("La cita ya esta cancelada.")
        self.estado = "CANCELADA"
        self.motivo_cancelacion = motivo
        print("  [Negocio]  Cita " + self.id_cita
              + " -> CANCELADA. Motivo: " + motivo)

    def __repr__(self):
        return ("CitaMedica(id=" + self.id_cita
                + ", paciente=" + self.paciente
                + ", estado=" + self.estado + ")")


# ------------------------------------------------------------
#  Clase 2: SOLO persistencia en base de datos
#  Razon para cambiar: motor o esquema de BD
# ------------------------------------------------------------
class CitaRepository:
    """
    [OK] Responsabilidad unica: guardar y consultar citas en BD.
    Si migramos de PostgreSQL a Oracle XE, solo cambia esta clase.
    """

    def guardar(self, cita):
        print("  [Repositorio]  INSERT INTO citas -> "
              "id=" + cita.id_cita
              + ", estado=" + cita.estado
              + ", paciente=" + cita.paciente
              + ", fecha=" + cita.fecha)

    def actualizar_estado(self, cita):
        print("  [Repositorio]  UPDATE citas SET estado='"
              + cita.estado + "' WHERE id_cita='" + cita.id_cita + "'")

    def buscar_por_paciente(self, nombre_paciente):
        # En produccion: SELECT * FROM citas WHERE paciente = ?
        print("  [Repositorio]  SELECT * FROM citas "
              "WHERE paciente = '" + nombre_paciente + "'")
        return []  # Simulado


# ------------------------------------------------------------
#  Clase 3: SOLO notificaciones por correo
#  Razon para cambiar: proveedor SMTP o plantilla de email
# ------------------------------------------------------------
class EmailNotificador:
    """
    [OK] Responsabilidad unica: enviar emails al paciente.
    Si cambiamos de SMTP a SendGrid, solo cambia esta clase.
    """

    def enviar_confirmacion(self, cita):
        print("  [Email]  Para: " + cita.paciente + "@email.com")
        print("  [Email]  Asunto: Cita #" + cita.id_cita + " confirmada")
        print("  [Email]  Dr. " + cita.medico
              + " | " + cita.fecha + " " + cita.hora)

    def enviar_cancelacion(self, cita):
        motivo = cita.motivo_cancelacion or "Sin motivo registrado"
        print("  [Email]  Para: " + cita.paciente + "@email.com")
        print("  [Email]  Asunto: Cita #" + cita.id_cita + " cancelada")
        print("  [Email]  Motivo: " + motivo)


# ------------------------------------------------------------
#  Clase 4: SOLO notificaciones por SMS
#  Razon para cambiar: proveedor SMS (Twilio, AWS SNS, etc.)
# ------------------------------------------------------------
class SMSNotificador:
    """
    [OK] Responsabilidad unica: enviar SMS de recordatorio.
    Si cambiamos de Twilio a AWS SNS, solo cambia esta clase.
    """

    def enviar_recordatorio(self, cita):
        print("  [SMS]  Para: " + cita.paciente)
        print("  [SMS]  Recordatorio: cita el " + cita.fecha
              + " a las " + cita.hora
              + " con Dr. " + cita.medico)


# ============================================================
#  USO: cada clase cumple su unica responsabilidad
# ============================================================

repositorio  = CitaRepository()
email_notif  = EmailNotificador()
sms_notif    = SMSNotificador()

# ------ Flujo 1: Agendar y confirmar cita ------------------
print("--- Flujo 1: Agendar y confirmar cita ---")
print()

cita1 = CitaMedica("C-002", "Maria Torres", "Dr. Ramirez",
                   "2026-09-20", "02:30 PM")

repositorio.guardar(cita1)         # <-- solo BD
cita1.confirmar()                  # <-- solo negocio
repositorio.actualizar_estado(cita1)  # <-- solo BD
email_notif.enviar_confirmacion(cita1)  # <-- solo email
sms_notif.enviar_recordatorio(cita1)    # <-- solo SMS

print()

# ------ Flujo 2: Cancelar una cita -------------------------
print("--- Flujo 2: Cancelar una cita ---")
print()

cita2 = CitaMedica("C-003", "Luis Herrera", "Dra. Vargas",
                   "2026-09-22", "09:00 AM")

repositorio.guardar(cita2)
cita2.cancelar("Paciente no puede asistir por viaje de trabajo")
repositorio.actualizar_estado(cita2)
email_notif.enviar_cancelacion(cita2)

print()

# ------ Flujo 3: Buscar citas de un paciente ---------------
print("--- Flujo 3: Consulta por paciente ---")
print()
repositorio.buscar_por_paciente("Maria Torres")

print()
print("=" * 60)
print("  CONCLUSION")
print("=" * 60)
print()
print("  Clase            | Responsabilidad        | Razon para cambiar")
print("  " + "-" * 57)
print("  CitaMedica       | Logica de negocio      | Reglas del dominio")
print("  CitaRepository   | Persistencia en BD     | Motor o esquema de BD")
print("  EmailNotificador | Notificacion email     | Proveedor SMTP/plantilla")
print("  SMSNotificador   | Notificacion SMS       | Proveedor SMS")
print()
print("  Cada clase tiene UNA razon para cambiar -> SRP cumplido [OK]")
