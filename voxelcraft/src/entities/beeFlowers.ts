/**
 * The flowers a bee will pollinate and breed with: vanilla's `#minecraft:flowers`, the small ones.
 * It lives in its own module because both the mob table and the bee's goal need it, and neither
 * should have to be loaded before the other.
 */
export const BEE_FLOWERS: string[] = [
  'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip',
  'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'wither_rose', 'torchflower', 'sunflower',
  'lilac', 'rose_bush', 'peony', 'pink_petals', 'flowering_azalea', 'flowering_azalea_leaves', 'cherry_leaves',
  'open_eyeblossom', 'closed_eyeblossom',
];
