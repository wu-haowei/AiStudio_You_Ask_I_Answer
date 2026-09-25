import React from 'react';

/*
 * A few messages emphasise a word or two mid-sentence — "this will <delete
 * first> …". Sentences cannot be built from separately translated pieces (other
 * languages order them differently), so the whole sentence stays one message
 * and the emphasis is marked inside it:
 *
 *   <b>…</b>  bold, for a number or a name
 *   <d>…</d>  bold and red, for the word that carries the warning
 *
 * Anything else is plain text. There is no nesting and no other tags, on
 * purpose — this is a formatter for our own strings, not an HTML parser.
 */
const TAG = /(<b>[\s\S]*?<\/b>|<d>[\s\S]*?<\/d>)/g;

export const Rich: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split(TAG).map((part, i) => {
      if (part.startsWith('<b>')) {
        return (
          <span key={i} className="font-bold text-[#3A2E2B]">
            {part.slice(3, -4)}
          </span>
        );
      }
      if (part.startsWith('<d>')) {
        return (
          <span key={i} className="font-bold text-rose-700">
            {part.slice(3, -4)}
          </span>
        );
      }
      return <React.Fragment key={i}>{part}</React.Fragment>;
    })}
  </>
);
