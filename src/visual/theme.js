export const THEMES = {
  neon: {
    id: 'neon',
    name: '霓虹音游',
    accent: '#3dfff2',
    accent2: '#f72585',
    palette: ['#3dfff2', '#4cc9f0', '#5b8cff', '#7b6cff', '#c77dff', '#f72585', '#ff5d8f', '#ff8a3d', '#ffe566', '#b6f25c', '#2ee6a6', '#49d6ff'],
    grid: 0.18,
    scan: 0.07,
    bg: ['#160818', '#07060f', '#101628'],
    housing: '#070910',
    white: ['#f7fbff', '#d5deee'],
    black: ['#2a2e40', '#0c0e14']
  },
  aurora: {
    id: 'aurora',
    name: '极光',
    accent: '#9bf6ff',
    accent2: '#c8b6ff',
    palette: ['#9bf6ff', '#a0c4ff', '#bdb2ff', '#caffbf', '#fdffb6', '#ffd6a5', '#ffadad', '#bde0fe', '#c8b6ff', '#a9def9', '#e4c1f9', '#d0f4de'],
    grid: 0.08,
    scan: 0.03,
    bg: ['#042830', '#03141c', '#063028'],
    housing: '#061216',
    white: ['#f3fffd', '#d5ebe4'],
    black: ['#24343a', '#0c1418']
  },
  cyber: {
    id: 'cyber',
    name: '赛博网格',
    accent: '#00f0ff',
    accent2: '#ff2bd6',
    palette: ['#00f0ff', '#00d4ff', '#3a86ff', '#7b61ff', '#ff2bd6', '#ff4d8d', '#7af0ff', '#8d7cff', '#ffe66d', '#00ffc6', '#ff4ad4', '#4cc9f0'],
    grid: 0.34,
    scan: 0.12,
    bg: ['#06101f', '#03060d', '#120818'],
    housing: '#05070e',
    white: ['#eefaff', '#c9d7ea'],
    black: ['#22283a', '#070910']
  },
  concert: {
    id: 'concert',
    name: '暖金演奏',
    accent: '#ffd166',
    accent2: '#e76f51',
    palette: ['#fff1c9', '#ffe08a', '#ffc46b', '#ffb347', '#f4a261', '#e9c46a', '#ffd6a5', '#faedcd', '#ffb703', '#fb8500', '#e76f51', '#f6bd60'],
    grid: 0.05,
    scan: 0,
    bg: ['#1a120c', '#0c0a08', '#24140e'],
    housing: '#100e0c',
    white: ['#fffaf3', '#eadfce'],
    black: ['#3a322c', '#14110e']
  }
};

export function getTheme(id) {
  return THEMES[id] || THEMES.neon;
}
