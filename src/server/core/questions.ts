import type { QuestionCategory } from '../../shared/types';

export type HouseQuestion = {
  text: string;
  category: QuestionCategory;
  yesLabel?: string;
  noLabel?: string;
};

/**
 * The 40 house questions. Day 1 is fixed to the first row; the rest are
 * pre-shuffled by hand so category rhythm stays varied and exactly one
 * Meta question lands in week 2 (day 10).
 */
export const HOUSE_QUESTIONS: HouseQuestion[] = [
  // Day 1 — fixed
  {
    text: 'Would you take $500K right now, or a coin flip at $5M?',
    category: 'MONEY',
    yesLabel: 'TAKE $500K',
    noLabel: 'FLIP FOR $5M',
  },
  {
    text: 'Your biggest monthly bill disappears forever. Are you choosing free rent, or free food?',
    category: 'MONEY',
    yesLabel: 'FREE RENT',
    noLabel: 'FREE FOOD',
  },
  {
    text: 'You get one impossible power for everyday life. Do you skip distance with teleportation, or steal extra time by pausing the world?',
    category: 'HYPOTHETICALS',
    yesLabel: 'TELEPORT',
    noLabel: 'PAUSE TIME',
  },
  {
    text: 'For the rest of your life, you are never exactly on time. Are you always 10 minutes late, or always 30 minutes early?',
    category: 'HOT TAKES',
    yesLabel: '10 MIN LATE',
    noLabel: '30 MIN EARLY',
  },
  {
    text: 'You can live rich with nobody knowing your name, or be widely known while living on normal money. Which life sounds better?',
    category: 'MONEY',
    yesLabel: 'RICH & UNKNOWN',
    noLabel: 'FAMOUS & NORMAL',
  },
  {
    text: 'Your mind can become either a perfect archive or a perfect delete button. Would you keep every memory, or forget anything on command?',
    category: 'HYPOTHETICALS',
    yesLabel: 'PERFECT MEMORY',
    noLabel: 'DELETE MEMORIES',
  },
  {
    text: 'One everyday annoyance disappears forever. Would you erase waiting in lines, or sitting in traffic?',
    category: 'HOT TAKES',
    yesLabel: 'NO LINES',
    noLabel: 'NO TRAFFIC',
  },
  {
    text: 'You wake up with one lifelong gift. Do you speak every language, or master every instrument?',
    category: 'HYPOTHETICALS',
    yesLabel: 'LANGUAGES',
    noLabel: 'INSTRUMENTS',
  },
  {
    text: 'You lose one while traveling, and you cannot replace it immediately. Your phone for a month, or your wallet for a week?',
    category: 'HOT TAKES',
    yesLabel: 'LOSE PHONE',
    noLabel: 'LOSE WALLET',
  },
  // Day 10 — the week-2 Meta question
  {
    text: "Will today's Split land within 5 points of 50?",
    category: 'META',
  },
  {
    text: 'A guaranteed check hits every month forever, or a million lands today with nothing after. Which deal feels smarter?',
    category: 'MONEY',
    yesLabel: '$10K/MONTH',
    noLabel: '$1M TODAY',
  },
  {
    text: 'You can be deeply understood by a few people, or instantly liked by almost everyone. Which one would you rather have?',
    category: 'MORALS',
    yesLabel: 'UNDERSTOOD',
    noLabel: 'LIKED',
  },
  {
    text: 'Your dream life costs you some comfort. Do you choose the tiny place in your dream city, or the huge home somewhere boring?',
    category: 'HYPOTHETICALS',
    yesLabel: 'DREAM CITY',
    noLabel: 'HUGE HOME',
  },
  {
    text: 'Your work week can be lighter with less money, or heavier with much more money. Are you protecting time, or chasing income?',
    category: 'MONEY',
    yesLabel: 'MORE TIME',
    noLabel: 'MORE MONEY',
  },
  {
    text: 'Everyone likes you a little, or a few people love you completely. Which kind of love would you rather live with?',
    category: 'MORALS',
    yesLabel: 'LIKED BY MANY',
    noLabel: 'LOVED DEEPLY',
  },
  {
    text: 'Every trip becomes cheaper, but only one part is free. Are you taking free flights for life, or free hotels for life?',
    category: 'MONEY',
    yesLabel: 'FREE FLIGHTS',
    noLabel: 'FREE HOTELS',
  },
  {
    text: 'At every gathering, people either laugh because of you or listen because of you. Would you rather be the funniest, or the smartest in the room?',
    category: 'HOT TAKES',
    yesLabel: 'FUNNIEST',
    noLabel: 'SMARTEST',
  },
  {
    text: 'You get one confidence upgrade overnight. Would you choose your dream body, or your dream voice?',
    category: 'HYPOTHETICALS',
    yesLabel: 'DREAM BODY',
    noLabel: 'DREAM VOICE',
  },
  {
    text: 'One friend truly gets you, or a big circle always keeps life fun. Which version of friendship wins?',
    category: 'MORALS',
    yesLabel: 'ONE TRUE FRIEND',
    noLabel: 'BIG FRIEND GROUP',
  },
  {
    text: 'Is the crowd usually wiser than its smartest person?',
    category: 'META',
  },
  {
    text: 'One chore vanishes from your life forever. Are you never cooking again, or never cleaning again?',
    category: 'HOT TAKES',
    yesLabel: 'NO COOKING',
    noLabel: 'NO CLEANING',
  },
  {
    text: 'Once a year, life gives you one power over a decision. Do you undo one choice, or preview one choice before making it?',
    category: 'HYPOTHETICALS',
    yesLabel: 'UNDO',
    noLabel: 'PREVIEW',
  },
  {
    text: 'Your career splits into two paths. $200K doing boring work, or $80K doing work that makes you feel alive?',
    category: 'MONEY',
    yesLabel: '$200K BORING',
    noLabel: '$80K ALIVE',
  },
  {
    text: 'People can remember you as stable but predictable, or exciting but unreliable. Which reputation would you rather have?',
    category: 'HOT TAKES',
    yesLabel: 'STABLE',
    noLabel: 'EXCITING',
  },
  {
    text: 'You can be respected without being fully liked, or liked without being fully respected. Which one hurts less?',
    category: 'MORALS',
    yesLabel: 'RESPECTED',
    noLabel: 'LIKED',
  },
  {
    text: 'The internet gives you one mercy forever. No ads anywhere, or no passwords anywhere?',
    category: 'HOT TAKES',
    yesLabel: 'NO ADS',
    noLabel: 'NO PASSWORDS',
  },
  {
    text: 'You get one time-machine ticket. Relive your best day, or skip your worst day?',
    category: 'HYPOTHETICALS',
    yesLabel: 'RELIVE BEST',
    noLabel: 'SKIP WORST',
  },
  {
    text: 'Your safe path pays well but never explodes. Your risky path could make you rich or send you back to zero. Which path are you taking?',
    category: 'MONEY',
    yesLabel: 'SAFE PATH',
    noLabel: 'RISKY PATH',
  },
  {
    text: 'One truth power becomes yours. Always know when someone is lying, or always get away with lying?',
    category: 'MORALS',
    yesLabel: 'SPOT LIES',
    noLabel: 'GET AWAY',
  },
  {
    text: 'Every disagreement can end in your victory, or stop mattering to you completely. Win every argument, or never need to argue again?',
    category: 'HOT TAKES',
    yesLabel: 'WIN ARGUMENTS',
    noLabel: 'NO ARGUMENTS',
  },
  {
    text: 'You can talk to every animal, or see the dreams people never say out loud. Which secret world would you open?',
    category: 'HYPOTHETICALS',
    yesLabel: 'ANIMALS',
    noLabel: 'DREAMS',
  },
  {
    text: 'One private part of your life becomes public. Search history, or camera roll?',
    category: 'HOT TAKES',
    yesLabel: 'SEARCH HISTORY',
    noLabel: 'CAMERA ROLL',
  },
  {
    text: 'Your talent can go deep or wide. Would you be elite at one thing, or pretty good at almost everything?',
    category: 'HYPOTHETICALS',
    yesLabel: 'ELITE',
    noLabel: 'ALL-ROUNDER',
  },
  {
    text: 'Your future can be peaceful early, or luxurious forever. Retire young with a simple life, or keep working for a rich one?',
    category: 'MONEY',
    yesLabel: 'RETIRE YOUNG',
    noLabel: 'LUXURY LIFE',
  },
  {
    text: 'Every thought either comes out honestly, or every sentence hides what you really mean. Which curse would you rather live with?',
    category: 'MORALS',
    yesLabel: 'SAY THOUGHTS',
    noLabel: 'HIDE MEANING',
  },
  {
    text: 'Your social life gets one permanent upgrade. Free restaurants forever, or free concerts forever?',
    category: 'MONEY',
    yesLabel: 'RESTAURANTS',
    noLabel: 'CONCERTS',
  },
  {
    text: 'You can erase one embarrassing memory completely, but the lesson disappears with it. Do you erase it, or keep it?',
    category: 'HYPOTHETICALS',
    yesLabel: 'ERASE IT',
    noLabel: 'KEEP LESSON',
  },
  {
    text: 'A stranger gets to see one version of you: who you are online, or who you are in real life. Which one feels more honest?',
    category: 'MORALS',
    yesLabel: 'ONLINE SELF',
    noLabel: 'REAL-LIFE SELF',
  },
  {
    text: 'You can have the perfect daily routine, or one unforgettable adventure every year. Which life would you rather build?',
    category: 'HYPOTHETICALS',
    yesLabel: 'PERFECT ROUTINE',
    noLabel: 'YEARLY ADVENTURE',
  },
  {
    text: 'Does the crowd know you better than you know yourself?',
    category: 'META',
  },
];
