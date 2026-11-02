import React, { useMemo } from 'react';
import { commonValues } from './collectionUtils';

/* The columns of your sheet that BGG can't fill in (Book, House, Played, Added, Complete...), as boxes to type in. What a column
   already holds in your sheet (say House: GL, Sam) is offered as buttons to tap instead of typing. `fields` is
   [{ name, i }], `values` is { columnIndex: text }, and `rows` are the sheet's rows the buttons are worked out from. */

function ExtraFields({ fields, rows, values, onChange, hint = 'From your sheet. BGG fills in the rest.' }) {
  const choices = useMemo(() => Object.fromEntries(fields.map(({ i }) => [i, commonValues(rows, i)])), [fields, rows]);
  if (!fields.length) return null;
  return (
    <div className="gcExtras">
      <p className="gcHint">{hint}</p>
      {fields.map(({ name, i }) => (
        <div className="gcField" key={i}>
          <span>{name}</span>
          {choices[i].length > 0 && (
            <div className="gcPills">
              {choices[i].map((v) => (
                <button key={v} type="button" className={`gcPill${values[i] === v ? ' gcOn' : ''}`} aria-pressed={values[i] === v} onClick={() => onChange({ ...values, [i]: values[i] === v ? '' : v })}>{v}</button>
              ))}
            </div>
          )}
          <input className="gcInput" aria-label={name} value={values[i] || ''} onChange={(e) => onChange({ ...values, [i]: e.target.value })} />
        </div>
      ))}
    </div>
  );
}

export default ExtraFields;
