import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { navigate, useRoute } from '../../lib/router';
import { endTrail, hasTrail, onTrailChange, remaining, requestBellOpen, takeNext, trailFolder } from './trail';
import { onVisited } from './visits';

/**
 * Kleine Leiste unten in der Mitte, solange man über die Glocke irgendwohin gekommen ist:
 * „Neuigkeiten“ führt zurück und öffnet die Glocke, „Nächste“ springt gleich zur nächsten ungelesenen.
 */
export function BellTrail() {
  const route = useRoute();
  const [, setTick] = useState(0);
  useEffect(() => {
    const re = () => setTick((t) => t + 1);
    const a = onTrailChange(re);
    const b = onVisited(re);
    return () => {
      a();
      b();
    };
  }, []);

  // Woandershin gegangen (Übersicht, anderer Ordner/Unterordner, anderer Bereich): der Weg ist zu Ende.
  const away = route.tab !== 'ordner' || !route.folderId || route.folderId !== trailFolder();
  useEffect(() => {
    if (away) endTrail();
  }, [route.tab, route.folderId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (away || !hasTrail()) return null;

  const more = remaining().length;
  return (
    <div className="bell-trail" role="navigation" aria-label="Neuigkeiten">
      <button
        className="bell-trail-btn"
        onClick={() => {
          requestBellOpen();
          navigate('#ordner');
        }}
      >
        <Icon name="bell" size={17} /> Neuigkeiten
      </button>
      {more > 0 && (
        <button
          className="bell-trail-btn next"
          onClick={() => {
            const url = takeNext();
            if (url) navigate(url);
          }}
        >
          Nächste ({more}) <Icon name="chevron" size={16} />
        </button>
      )}
    </div>
  );
}
