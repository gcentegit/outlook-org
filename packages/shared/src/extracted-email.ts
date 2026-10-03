/**
 * Correo ya convertido a texto, listo para clasificar. Lo produce la extracción
 * (Graph + docling) y lo consume el clasificador; ninguno de los dos depende del otro.
 */
export interface ExtractedAttachment {
  name: string;
  contentType: string;
  /** SHA-256 del contenido binario; clave de la caché de `AttachmentText`. */
  sha256: string;
  /** Markdown devuelto por docling; vacío si el tipo no está soportado o falló la conversión. */
  markdown: string;
  method: 'text' | 'ocr' | 'skipped';
}

export interface ExtractedEmail {
  messageId: string;
  conversationId: string | null;
  internetMessageId: string | null;
  receivedAt: Date;
  fromAddress: string | null;
  fromName: string | null;
  subject: string;
  /** Cuerpo en texto plano (el HTML ya convertido). */
  bodyText: string;
  /** Categorías que tenía el correo al leerlo (las del equipo, si las hay). */
  categories: string[];
  attachments: ExtractedAttachment[];
  /**
   * Fallos técnicos pasajeros al extraer (docling caído, descarga fallida): el texto de algún
   * adjunto falta por eso y la decisión que salga no es definitiva. Ausente o vacío si todo fue bien.
   */
  degradedReasons?: string[];
}
