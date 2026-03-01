export const TRAVEL_TERRAINS = Object.freeze([
  { key: "lightWoodland", label: "Light Woodland" },
  { key: "hills", label: "Hills" },
  { key: "deepForest", label: "Deep Forest" },
  { key: "temperatePlains", label: "Temperate Plains" },
  { key: "wetland", label: "Wetland" },
  { key: "mountains", label: "Mountains" },
]);

export const TERRAIN_MODIFIERS = Object.freeze({
  lightWoodland: Object.freeze({
    navigation: 0,
    water: 0,
    foraging: 10,
    huntFish: 10,
    makeCamp: 20,
    watch: 0,
  }),
  hills: Object.freeze({
    navigation: 0,
    water: -10,
    foraging: -10,
    huntFish: 0,
    makeCamp: 0,
    watch: 10,
  }),
  deepForest: Object.freeze({
    navigation: -20,
    water: -10,
    foraging: 10,
    huntFish: -10,
    makeCamp: 10,
    watch: -10,
  }),
  temperatePlains: Object.freeze({
    navigation: 10,
    water: 0,
    foraging: 0,
    huntFish: 10,
    makeCamp: -10,
    watch: 10,
  }),
  wetland: Object.freeze({
    navigation: -10,
    water: 20,
    foraging: -10,
    huntFish: 10,
    makeCamp: -10,
    watch: 10,
  }),
  mountains: Object.freeze({
    navigation: -20,
    water: 20,
    foraging: -20,
    huntFish: -20,
    makeCamp: -10,
    watch: -10,
  }),
});

