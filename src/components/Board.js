import React from 'react';
import { useNavigate } from "react-router-dom";
import './Home.css';
import './Board.css';
import "./fonts/Merisa-gxvMY.ttf";

// How many online games are waiting for your move on this device (the games report it for the Game Night page).
function gamesWaiting() {
  try {
    const games = JSON.parse(localStorage.getItem('nerdalie.hub.games')) || {};
    return Object.values(games).filter((g) => g && g.status === 'your-turn' && g.mode === 'online').length;
  } catch (_) {
    return 0;
  }
}

function Home() {
  const navigate = useNavigate();
  const waiting = gamesWaiting();
  const navUno = (e) => {
    e.preventDefault();
    navigate('/Uno')
  };
  const navQwinto = (e) => {
    e.preventDefault();
    navigate('/Qwinto')
  }
  // The online game is a self-contained page in public/qwinto-online, not a React route.
  const navQwintoOnline = (e) => {
    e.preventDefault();
    window.location.href = `${process.env.PUBLIC_URL}/qwinto-online/`;
  };
  const navAgentAvenue = (e) => {
    e.preventDefault();
    window.location.href = `${process.env.PUBLIC_URL}/agent-avenue/`;
  };
  const navLostCities = (e) => {
    e.preventDefault();
    window.location.href = `${process.env.PUBLIC_URL}/lost-cities/`;
  };
  const navScout = (e) => {
    e.preventDefault();
    window.location.href = `${process.env.PUBLIC_URL}/scout/`;
  };
  const navHocusPocus = (e) => {
    e.preventDefault();
    window.location.href = `${process.env.PUBLIC_URL}/hocus-pocus/`;
  };
  const navToyBattle = (e) => {
    e.preventDefault();
    window.location.href = `${process.env.PUBLIC_URL}/toy-battle/`;
  };
  const navJaipur = (e) => {
    e.preventDefault();
    window.location.href = `${process.env.PUBLIC_URL}/jaipur/`;
  };
  const navOnitama = (e) => {
    e.preventDefault();
    window.location.href = `${process.env.PUBLIC_URL}/onitama/`;
  };
  // the newer two-player games are plain static pages under public/
  const openStatic = (dir) => (e) => {
    e.preventDefault();
    window.location.href = `${process.env.PUBLIC_URL}/${dir}/`;
  };
  const navGameNight = (e) => {
    e.preventDefault();
    window.location.href = `${process.env.PUBLIC_URL}/game-night/`;
  };
  // Collection is a real React route (it needs client state/settings), not a public/ static page.
  const navCollection = (e) => {
    e.preventDefault();
    navigate('/Games');
  };
  return (
  <body className="pageHome"> 
    <div className="HomePage">
      <h1 className='title'> HEY BEAUTIFUL </h1>
      <h1 className='subtitle'> WANNA PLAY A GAME</h1>
      <div className="buttonsContainer">
        <button className="sillyButton" id="buttons" onClick={navUno}> UNO</button>
        <button className="boredButton" id="buttons" onClick={navQwinto} > QWINTO</button>
        <button className="onlineButton" id="buttons" onClick={navQwintoOnline}> QWINTO ONLINE</button>
        <button className="agentButton" id="buttons" onClick={navAgentAvenue}> AGENT AVENUE</button>
        <button className="lostButton" id="buttons" onClick={navLostCities}> LOST CITIES</button>
        <button className="scoutButton" id="buttons" onClick={navScout}> SCOUT</button>
        <button className="hocusButton" id="buttons" onClick={navHocusPocus}> HOCUS POCUS</button>
        <button className="toyButton" id="buttons" onClick={navToyBattle}> TOY BATTLE</button>
        <button className="jaipurButton" id="buttons" onClick={navJaipur}> JAIPUR</button>
        <button className="onitamaButton" id="buttons" onClick={navOnitama}> ONITAMA</button>
        <button className="schottenButton" id="buttons" onClick={openStatic('schotten-totten')}> SCHOTTEN TOTTEN</button>
        <button className="santoriniButton" id="buttons" onClick={openStatic('santorini')}> SANTORINI</button>
        <button className="reversiButton" id="buttons" onClick={openStatic('reversi')}> REVERSI</button>
        <button className="mancalaButton" id="buttons" onClick={openStatic('mancala')}> MANCALA</button>
        <button className="quartoButton" id="buttons" onClick={openStatic('quarto')}> QUARTO</button>
        <button className="checkersButton" id="buttons" onClick={openStatic('checkers')}> CHECKERS</button>
        <button className="nightButton" id="buttons" onClick={navGameNight} aria-label={waiting ? `Game night, your move in ${waiting} game${waiting === 1 ? '' : 's'}` : 'Game night'}>
          GAME NIGHT{waiting > 0 && <span className="nightBadge">{waiting}</span>}
        </button>
        <button className="collectionButton" id="buttons" onClick={navCollection}> GAME LIST</button>

      </div>
    </div>
  </body>
  );
}

export default Home;