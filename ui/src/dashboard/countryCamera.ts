import type { Bounds } from './cameraPlan.js';

// Geographic envelopes for camera framing only. Never used to classify incidents or relocate pins.
export const COUNTRY_CAMERA_BOUNDS: Readonly<Record<string, Bounds>> = {
  Brunei: {south:4,west:114,north:5.1,east:115.4},
  Cambodia: {south:10.4,west:102.3,north:14.7,east:107.7},
  Indonesia: {south:-11.1,west:95,north:6.1,east:141.1},
  Laos: {south:13.9,west:100,north:22.6,east:107.7},
  Malaysia: {south:.8,west:99.5,north:7.5,east:119.5},
  Myanmar: {south:9.5,west:92.1,north:28.6,east:101.2},
  Philippines: {south:4.5,west:116.9,north:21.3,east:126.7},
  Singapore: {south:1.15,west:103.6,north:1.48,east:104.1},
  Thailand: {south:5.6,west:97.3,north:20.5,east:105.7},
  'Timor-Leste': {south:-9.5,west:124,north:-8.1,east:127.4},
  'Viet Nam': {south:8.1,west:102.1,north:23.5,east:109.6},
};
