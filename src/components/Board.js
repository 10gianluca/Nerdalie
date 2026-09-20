import React from 'react';
import { useNavigate } from "react-router-dom";
import './Home.css';
import "./fonts/Merisa-gxvMY.ttf";

function Home() {
  const navigate = useNavigate();
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
  return (
  <body className="pageHome"> 
    <div className="HomePage">
      <h1 className='title'> HEY BEAUTIFUL </h1>
      <h1 className='subtitle'> WANNA PLAY A GAME</h1>
      <div class="buttonsContainer">
        <button className="sillyButton" id="buttons" onClick={navUno}> UNO</button>
        <button className="boredButton" id="buttons" onClick={navQwinto} > QWINTO</button>
        <button className="onlineButton" id="buttons" onClick={navQwintoOnline}> QWINTO ONLINE</button>
        <button className="agentButton" id="buttons" onClick={navAgentAvenue}> AGENT AVENUE</button>
        <button className="lostButton" id="buttons" onClick={navLostCities}> LOST CITIES</button>
        <button className="scoutButton" id="buttons" onClick={navScout}> SCOUT</button>

      </div>
    </div>
  </body>
  );
}

export default Home;