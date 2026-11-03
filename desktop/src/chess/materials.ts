// Chessboard materials: pairs of real Terraria blocks from the local install, chosen so light and
// dark squares contrast clearly and both piece colours stay readable on either. `avg` is each
// block's measured average colour (from the installed tile sheets); it is also the fallback colour
// when the install isn't available, so the board looks right either way.

export interface Block {
  /** Texture name under the install's Content/Images (loaded at runtime, never copied). */
  tex: string;
  name: string;
  avg: [number, number, number];
}

export interface BoardMaterial {
  id: string;
  name: string;
  light: Block;
  dark: Block;
  /** The frame around the board. */
  frame: Block;
}

const B = (tex: string, name: string, avg: [number, number, number]): Block => ({ tex: `Images/${tex}`, name, avg });

// Measured from the installed sheets (centre tile, 16×16): see docs/chess-and-movement-modes.md.
export const BLOCKS = {
  marble: B("Tiles_357", "Marble Block", [175, 185, 209]),
  mahogany: B("Tiles_158", "Rich Mahogany", [120, 68, 71]),
  snowBrick: B("Tiles_148", "Snow Brick", [171, 193, 214]),
  grayBrick: B("Tiles_38", "Gray Brick", [107, 107, 107]),
  sandstoneBrick: B("Tiles_151", "Sandstone Brick", [166, 156, 86]),
  blueDungeon: B("Tiles_41", "Blue Dungeon Brick", [56, 63, 80]),
  pearlstoneBrick: B("Tiles_118", "Pearlstone Brick", [163, 151, 160]),
  candyCane: B("Tiles_145", "Candy Cane Block", [214, 108, 130]),
  greenCandyCane: B("Tiles_146", "Green Candy Cane Block", [106, 217, 144]),
  iceBrick: B("Tiles_206", "Ice Brick", [159, 200, 235]),
  cobaltBrick: B("Tiles_121", "Cobalt Brick", [28, 112, 164]),
  wood: B("Tiles_30", "Wood", [142, 103, 76]),
  stone: B("Tiles_1", "Stone", [116, 116, 116]),
  obsidianBrick: B("Tiles_75", "Obsidian Brick", [36, 39, 44]),
  livingWood: B("Tiles_191", "Living Wood", [156, 113, 82]),
  redBrick: B("Tiles_39", "Red Brick", [137, 82, 76]),
};

export const MATERIALS: BoardMaterial[] = [
  { id: "marble", name: "Marble & Mahogany", light: BLOCKS.marble, dark: BLOCKS.mahogany, frame: BLOCKS.wood },
  { id: "snow", name: "Snow & Stone Brick", light: BLOCKS.snowBrick, dark: BLOCKS.grayBrick, frame: BLOCKS.obsidianBrick },
  { id: "dungeon", name: "Sandstone & Dungeon", light: BLOCKS.sandstoneBrick, dark: BLOCKS.blueDungeon, frame: BLOCKS.obsidianBrick },
  { id: "hallow", name: "Pearlstone & Red Brick", light: BLOCKS.pearlstoneBrick, dark: BLOCKS.redBrick, frame: BLOCKS.livingWood },
  { id: "ice", name: "Ice & Cobalt", light: BLOCKS.iceBrick, dark: BLOCKS.cobaltBrick, frame: BLOCKS.grayBrick },
  { id: "candy", name: "Candy Cane (festive)", light: BLOCKS.greenCandyCane, dark: BLOCKS.candyCane, frame: BLOCKS.wood },
];

export const DEFAULT_MATERIAL = "marble";

export const materialById = (id: string | undefined) => MATERIALS.find((m) => m.id === id) ?? MATERIALS[0];

export const luminance = ([r, g, b]: readonly number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export const rgb = ([r, g, b]: readonly number[]) => `rgb(${r}, ${g}, ${b})`;
