// P12b: background colours are parsed without a canvas (workers in older Safari have none).
// Checks the built-in parsing against what a real canvas makes of the same CSS colour.
import { describe, expect, it } from 'vitest';
import { parseBackground } from './background';

/** The colour a 2D canvas paints for `css`, mixed over white like parseBackground does. */
function canvasColour(css: string): number[] {
  const ctx = new OffscreenCanvas(1, 1).getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  return Array.from(ctx.getImageData(0, 0, 1, 1).data.subarray(0, 3));
}

const NAMES =
  'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'.split(
    ' ',
  );

describe('parseBackground matches the canvas without needing one', () => {
  it('every CSS named colour (148)', () => {
    expect(NAMES).toHaveLength(148);
    for (const name of NAMES) expect([...parseBackground(name)], name).toEqual(canvasColour(name));
    expect([...parseBackground('RebeccaPurple')]).toEqual(canvasColour('rebeccapurple'));
  });

  it.each([
    'hsl(0 100% 50%)',
    'hsl(120, 100%, 25%)',
    'hsl(200deg 50% 50%)',
    'hsl(0.5turn 40% 60%)',
    'hsl(-30 80% 45%)',
    'hsl(400 30% 70%)',
    'hsl(3.14159rad 60% 40%)',
    'hsl(100grad 20% 80%)',
    'hsla(210, 60%, 40%, 0.5)',
    'hsl(30 90% 55% / 25%)',
  ])('%s', (css) => {
    const ours = parseBackground(css);
    const theirs = canvasColour(css);
    // Rounding of the hsl → rgb maths may differ by one level.
    ours.forEach((v, i) => expect(Math.abs(v - theirs[i]!), css).toBeLessThanOrEqual(1));
  });
});
