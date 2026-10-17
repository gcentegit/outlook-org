import type { TeamSource } from '@/server/metrics';

const TEAM_SOURCE_LABELS: Record<TeamSource, string> = {
  people: 'el equipo',
  cif: 'CIF',
  folder: 'la carpeta',
};

/** De dónde sale la referencia; en verde solo si toda la puso una persona. */
export function ReferenceSource({
  sources,
  reviewed,
}: {
  sources: TeamSource[];
  reviewed: boolean;
}) {
  if (sources.length === 0) {
    return (
      <p className="mt-1 text-xs text-muted">
        {reviewed ? 'El equipo no puso ninguna' : 'Sin contrastar'}
      </p>
    );
  }
  const byPeople = sources.length === 1 && sources[0] === 'people';
  return (
    <p className={`mt-1 text-xs font-medium ${byPeople ? 'text-success' : 'text-warning'}`}>
      Por {sources.map((s) => TEAM_SOURCE_LABELS[s]).join(' y ')}
    </p>
  );
}
