# -*- coding: utf-8 -*-
# ============================================================
#  PRINCIPIO DE RESPONSABILIDAD UNICA (SRP) - SOLID
#  Contexto: Sistema de Citas Medicas - IS-III FI303290
#  PARTE 1: DISENO QUE VIOLA EL SRP
# ============================================================
#
#  La clase CitaMedica_MAL tiene TRES razones para cambiar:
#    1. Si cambia la logica de negocio de una cita
#    2. Si cambia el motor de base de datos
#    3. Si cambia el canal o formato de notificacion
# ============================================================

print("=" * 60)
print("  [MAL] DISENO QUE VIOLA EL SRP")
print("=" * 60)

class CitaMedica_MAL:
    """
    [MAL] Viola SRP: esta clase mezcla logica de negocio,
    persistencia y notificacion en un solo lugar.
    """

    def __init__(self, id_cita, paciente, medico, fecha, hora):
        self.id_cita  = id_cita
        self.paciente = paciente
        self.medico   = medico
        self.fecha    = fecha
        self.hora     = hora
        self.estado   = "PENDIENTE"

    # --- Responsabilidad 1: logica de negocio ---
    def confirmar(self):
        if self.estado == "PENDIENTE":
            self.estado = "CONFIRMADA"
            print("  [Negocio]  Cita " + self.id_cita + " confirmada.")
        else:
            print("  [Negocio]  Estado actual: " + self.estado)

    def cancelar(self, motivo):
        self.estado = "CANCELADA"
        print("  [Negocio]  Cita " + self.id_cita + " cancelada. Motivo: " + motivo)

    # --- Responsabilidad 2: persistencia en base de datos ---
    def guardar_en_bd(self):
        # [MAL] Logica de BD mezclada con logica de dominio
        print("  [Base de datos]  Conectando a PostgreSQL...")
        print("  [Base de datos]  INSERT INTO citas VALUES ('"
              + self.id_cita + "', '"
              + self.paciente + "', '"
              + self.medico + "', '"
              + self.fecha + "', '"
              + self.estado + "')")
        print("  [Base de datos]  Cita guardada.")

    def actualizar_estado_en_bd(self):
        # [MAL] Si migramos a Oracle o MongoDB, esta clase cambia
        print("  [Base de datos]  UPDATE citas SET estado='"
              + self.estado + "' WHERE id='" + self.id_cita + "'")

    # --- Responsabilidad 3: notificaciones ---
    def enviar_email_confirmacion(self):
        # [MAL] Si cambiamos de SMTP a SendGrid, esta clase cambia
        print("  [Email]  Conectando a servidor SMTP...")
        print("  [Email]  Para: " + self.paciente + "@email.com")
        print("  [Email]  Asunto: Confirmacion de cita medica #" + self.id_cita)
        print("  [Email]  Cita con Dr. " + self.medico
              + " - estado: " + self.estado
              + " - fecha: " + self.fecha
              + " - hora: " + self.hora)

    def enviar_sms_recordatorio(self):
        # [MAL] Si cambiamos de Twilio a AWS SNS, esta clase cambia
        print("  [SMS]  Enviando SMS al paciente " + self.paciente + "...")
        print("  [SMS]  Recordatorio: cita el " + self.fecha
              + " a las " + self.hora
              + " con Dr. " + self.medico)


# ------------------------------------------------------------
#  Uso del diseno que viola SRP
# ------------------------------------------------------------
print()
cita_mal = CitaMedica_MAL("C-001", "Carlos Lopez", "Dra. Gomez",
                           "2026-09-15", "10:00 AM")

cita_mal.confirmar()            # Negocio
cita_mal.guardar_en_bd()        # BD mezclada con negocio
cita_mal.enviar_email_confirmacion()   # Notificacion mezclada
cita_mal.enviar_sms_recordatorio()

print()
print("  PROBLEMA:")
print("  - Si cambia el motor de BD  -> modificar CitaMedica_MAL")
print("  - Si cambia el formato email -> modificar CitaMedica_MAL")
print("  - Si cambian reglas negocio  -> modificar CitaMedica_MAL")
print("  Tres razones para cambiar = VIOLA SRP")
print()
