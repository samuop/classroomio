/** Qué se le hace a un ítem del plan. Ausente = `create`, como todo plan anterior. */
export type CoursePlanItemAction = 'create' | 'rewrite' | 'edit';

export interface CoursePlanSectionItem {
  type: 'lesson' | 'exercise';
  title: string;
  description: string;
  order: number;
  hasExercise: boolean;
  /** Sólo en un plan de cambios. Ausente = se crea de cero. */
  action?: CoursePlanItemAction;
  /** La manija (o el id) de la pieza existente sobre la que actúa. */
  target?: string;
  /** Qué le cambia, en una o dos oraciones: es lo que el docente lee para aprobar. */
  changes?: string;
  /**
   * Esta pieza se deja COMO ESTÁ, y `changes` dice por qué.
   *
   * El servidor niega un plan de cambios que calle una pieza donde el análisis
   * encontró el valor viejo (el curso terminaría enseñando el valor nuevo en un
   * lado y el viejo en otro). `skip` es la salida declarada, y existe para que
   * el docente VEA qué queda afuera y con qué motivo.
   */
  skip?: boolean;
  /** Las fuentes del curso de las que sale la lección, declaradas por el agente. */
  sources?: string[];
}

/**
 * Lo que el servidor midió al armar el plan: qué lecciones tienen material
 * atrás y cuáles no. Sólo viene cuando hay algo que decir.
 */
export interface CoursePlanCoverage {
  sourcesAttached: number;
  lessonsWithSource: number;
  /** Los títulos de las lecciones sin ninguna fuente real detrás. */
  lessonsWithoutSource: string[];
  /**
   * Las lecciones que citan una fuente que apenas nombra el tema (un temario,
   * un índice). Para el servidor valen como lecciones sin material.
   */
  lessonsWithWeakSource?: Array<{ lesson: string; sources: string[]; charactersOnTopic: number }>;
  citedSourcesThatDoNotExist?: Array<{ item: string; declarada: string }>;
  note?: string;
}

export interface CoursePlanSection {
  title: string;
  order: number;
  /** La sección del curso a la que pertenece este bloque. Ausente = sección nueva. */
  sectionId?: string;
  items: CoursePlanSectionItem[];
}

export interface CoursePlan {
  title: string;
  /**
   * De qué se trata el plan.
   *
   * Ausente en todo plan guardado antes de que esto existiera, y por eso es
   * opcional: un plan viejo tiene que seguir abriéndose igual.
   */
  scope?: 'course' | 'changes';
  sections: CoursePlanSection[];
  /** Ausente cuando todo el plan tiene material, o el curso no tiene fuentes. */
  coverage?: CoursePlanCoverage;
}
