/**
 * El mensaje con el que arranca el asistente cuando alguien crea un curso.
 *
 * Vive afuera del formulario porque es lo único que el formulario produce: todo
 * lo que se pregunta en las dos pantallas termina acá, y de acá sale lo que el
 * modelo lee para proponer el plan. Adentro del componente no se podía probar.
 *
 * Recibe los textos ya traducidos: así no depende del diccionario ni del idioma
 * activo, y se prueba con el mismo contenido que ve una persona.
 */

export interface TextosDelMensaje {
  publico: string;
  objetivo: string;
  modalidad: string;
  nivel: string;
  fuentes: string;
  pistaDeFuentes: string;
  documentos: string;
  pistaDeInvestigadas: string;
}

export interface DatosDelMensaje {
  descripcion: string;
  publico: string;
  objetivo: string;
  /** Etiqueta ya traducida, no el valor interno. */
  modalidad: string;
  nivel: string;
  enlaces: string[];
  documentos: string[];
  /** Cuántos de esos documentos los trajo la investigación web. */
  investigadas: number;
  textos: TextosDelMensaje;
}

export function armarMensajeInicial(datos: DatosDelMensaje): string {
  const { textos } = datos;
  const renglones: string[] = [datos.descripcion.trim()];

  renglones.push('');
  renglones.push(`${textos.publico}: ${datos.publico.trim()}`);

  if (datos.objetivo.trim()) {
    renglones.push(`${textos.objetivo}: ${datos.objetivo.trim()}`);
  }

  // Modalidad y nivel van en renglones separados: juntos quedaba
  // «Modalidad y nivel: A ritmo propio, Nada», que no se entiende.
  renglones.push(`${textos.modalidad}: ${datos.modalidad}`);
  renglones.push(`${textos.nivel}: ${datos.nivel}`);

  const enlaces = datos.enlaces.map((enlace) => enlace.trim()).filter(Boolean);

  if (enlaces.length > 0) {
    renglones.push('');
    renglones.push(`${textos.fuentes}: ${enlaces.join(', ')}`);
    renglones.push(textos.pistaDeFuentes);
  }

  if (datos.documentos.length > 0) {
    renglones.push('');
    renglones.push(`${textos.documentos}: ${datos.documentos.join(', ')}`);
  }

  if (datos.investigadas > 0) {
    renglones.push(textos.pistaDeInvestigadas);
  }

  return renglones.join('\n');
}
