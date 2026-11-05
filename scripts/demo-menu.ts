/**
 * The fictional Kijani Café, Ntinda: the demo menu on the marketing site.
 * Luganda fields are intentionally left empty (never machine-translated).
 */
export type Tag = "popular" | "spicy" | "vegetarian" | "new";

export interface DemoItem {
  name: string;
  description?: string;
  price?: number;
  tags?: Tag[];
  sizes?: [string, number][];
  addons?: [string, number][];
  soldOut?: boolean;
  hidden?: boolean;
}

export { DEMO_SLUG } from "../src/config/demo";

export const DEMO_RESTAURANT = {
  name: "Kijani Café",
  description: "Breakfast, local food and grills in the heart of Ntinda. Fresh juice every day.",
  brandColor: "#2F7A3E",
  cuisines: ["Ugandan", "Café", "Grill"],
  priceRange: 2,
  area: "Ntinda",
  address: "Ntinda Road, opposite the shopping centre, Kampala",
  lat: 0.3536,
  lng: 32.6121,
  deliveryNote: "We deliver in Ntinda, Naguru and Kiwatule. Delivery UGX 2,000.",
  hours: {
    mon: [["07:00", "22:00"]],
    tue: [["07:00", "22:00"]],
    wed: [["07:00", "22:00"]],
    thu: [["07:00", "22:00"]],
    fri: [["07:00", "23:30"]],
    sat: [["08:00", "23:30"]],
    sun: [["09:00", "21:00"]],
  },
  tables: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "Garden 1", "Garden 2", "Counter"],
};

export const DEMO_MENU: { category: string; items: DemoItem[] }[] = [
  {
    category: "Breakfast",
    items: [
      {
        name: "Rolex",
        description: "Chapati rolled with a two-egg omelette, tomato, onion and cabbage.",
        price: 5000,
        tags: ["popular"],
        addons: [["Extra egg", 1000], ["Cheese", 2000], ["Sausage", 1500], ["Avocado", 1000]],
      },
      { name: "Kikomando", description: "Chopped chapati with stewed beans. Filling and cheap.", price: 4000, tags: ["vegetarian"] },
      {
        name: "Katogo",
        description: "Matooke cooked with beans or offals, the classic Kampala breakfast.",
        sizes: [["With beans", 7000], ["With offals", 9000]],
      },
      { name: "Spanish omelette", description: "Three eggs with green pepper, onion and tomato, served with toast.", price: 7000 },
      { name: "Pancakes with honey", description: "Three pancakes with local honey and fresh fruit.", price: 8000, tags: ["new", "vegetarian"] },
      {
        name: "Full Kijani breakfast",
        description: "Two eggs, sausages, beans, toast, fruit and a cup of African tea.",
        price: 18000,
        tags: ["popular"],
      },
      { name: "Toast and eggs", description: "Buttered toast with two eggs, fried or scrambled.", price: 6000 },
    ],
  },
  {
    category: "Local dishes",
    items: [
      {
        name: "Luwombo",
        description: "Steamed in banana leaves with groundnut sauce. Allow 30 minutes.",
        tags: ["popular"],
        sizes: [["Chicken", 28000], ["Beef", 25000], ["Mushroom", 20000]],
      },
      {
        name: "Matooke with groundnut sauce",
        description: "Steamed matooke with smooth groundnut sauce.",
        price: 12000,
        tags: ["vegetarian"],
      },
      { name: "Posho and beans", description: "Maize meal with stewed beans.", price: 8000, tags: ["vegetarian"] },
      { name: "Beef stew", description: "Slow-cooked beef with rice or matooke.", price: 15000 },
      { name: "Chicken stew", description: "Local chicken stew with matooke or rice.", price: 22000 },
      { name: "Fish stew", description: "Lake Victoria tilapia in tomato stew, with posho or rice.", price: 30000 },
      {
        name: "Malakwang with sweet potatoes",
        description: "Sour malakwang greens in groundnut paste.",
        price: 12000,
        tags: ["vegetarian", "new"],
      },
      { name: "Beef pilau", description: "Spiced rice with beef, served with kachumbari.", price: 15000, tags: ["spicy"] },
    ],
  },
  {
    category: "Grills",
    items: [
      {
        name: "Pork muchomo",
        description: "Grilled pork with kachumbari and gonja.",
        tags: ["popular", "spicy"],
        sizes: [["Quarter kg", 12000], ["Half kg", 22000], ["1 kg", 40000]],
      },
      { name: "Beef skewers", description: "Three beef skewers grilled over charcoal.", price: 10000 },
      { name: "Grilled chicken", description: "Marinated and grilled.", sizes: [["Quarter", 15000], ["Half", 28000]] },
      { name: "Goat muchomo", description: "Goat meat grilled with onion and pepper.", price: 20000, tags: ["spicy"] },
      { name: "Whole grilled tilapia", description: "Grilled with lemon and chilli. Allow 25 minutes.", price: 35000 },
      { name: "Grilled sausages", description: "Two beef sausages off the grill.", price: 6000 },
    ],
  },
  {
    category: "Snacks",
    items: [
      { name: "Samosas (3)", description: "Crispy beef or vegetable samosas.", price: 3000 },
      { name: "Chapati", description: "Soft, flaky chapati.", price: 1000, tags: ["vegetarian"] },
      { name: "Mandazi (3)", description: "Sweet fried dough, perfect with tea.", price: 1500, tags: ["vegetarian"] },
      {
        name: "Chips",
        description: "Hand-cut chips.",
        tags: ["vegetarian"],
        sizes: [["Small", 4000], ["Large", 6000]],
        addons: [["Cheese", 2000]],
      },
      { name: "Chips and chicken", description: "Chips with a quarter grilled chicken.", price: 16000, tags: ["popular"] },
      { name: "Gonja", description: "Roasted sweet plantain.", price: 2000, tags: ["vegetarian"] },
      { name: "Nsenene", description: "Fried grasshoppers with onion, when in season.", price: 10000, tags: ["new"], soldOut: true },
      { name: "Kachumbari", description: "Fresh tomato and onion salad.", price: 2000, tags: ["vegetarian"] },
    ],
  },
  {
    category: "Juices",
    items: [
      {
        name: "Passion juice",
        description: "Fresh passion fruit, no added water.",
        tags: ["popular"],
        sizes: [["Small", 4000], ["Large", 6000]],
      },
      { name: "Mango juice", description: "Fresh mango.", sizes: [["Small", 4000], ["Large", 6000]] },
      { name: "Pineapple juice", description: "Fresh pineapple.", sizes: [["Small", 4000], ["Large", 6000]] },
      { name: "Watermelon juice", description: "Chilled fresh watermelon.", price: 5000 },
      { name: "Cocktail juice", description: "Passion, mango, pineapple and beetroot.", price: 7000 },
      { name: "Avocado smoothie", description: "Avocado, milk and honey.", price: 8000, tags: ["new"] },
    ],
  },
  {
    category: "Drinks",
    items: [
      {
        name: "African tea",
        description: "Milk tea brewed with ginger and tea masala.",
        tags: ["popular"],
        sizes: [["Cup", 3000], ["Flask", 10000]],
      },
      { name: "Black tea with lemon", price: 2000 },
      { name: "Ugandan coffee", description: "Bugisu arabica, black or white.", price: 5000 },
      { name: "Cappuccino", price: 8000 },
      { name: "Hot chocolate", price: 7000 },
      { name: "Soda", description: "Coke, Fanta or Sprite, 300 ml.", price: 2500 },
      { name: "Mineral water", sizes: [["500 ml", 2000], ["1.5 litres", 3000]] },
      { name: "Nile Special", description: "Local lager, 500 ml.", price: 6000 },
      { name: "Club Pilsener", description: "Local lager, 500 ml.", price: 6000 },
      { name: "Staff lunch", description: "Not for sale.", price: 0, hidden: true },
    ],
  },
];

export const DEMO_SPECIALS = [
  {
    title: "Breakfast deal",
    description: "A rolex and a cup of African tea.",
    price: 7000,
    days: [1, 2, 3, 4, 5],
    start: "07:00",
    end: "10:00",
    items: [["Rolex", 1], ["African tea", 1]] as [string, number][],
  },
  {
    title: "Happy hour",
    description: "Nile Special at a lower price.",
    price: 5000,
    days: [1, 2, 3, 4, 5, 6, 7],
    start: "17:00",
    end: "19:00",
    items: [["Nile Special", 1]] as [string, number][],
  },
];
