import React from "react";
import { Route, Routes } from "react-router-dom";
import Silly from "./components/Silly";
import Home from "./components/Home";
import Bored from "./components/Bored";
import Board from "./components/Board";
import Uno from "./components/Uno";
import Qwinto from "./components/Qwinto";
import Love from "./components/Love"
import Collection from "./components/Collection"
import "./fonts/Merisa-gxvMY.ttf";
import "./fonts/IMFellDWPica-Italic.ttf"


function App() {
  return( 
    <Routes>
      <Route   path="/" element={<Home />} />
      <Route   path="/Silly" element={<Silly />} />
      <Route   path="/Bored" element={<Bored />} />
      <Route   path="/Board" element={<Board />} />
      <Route   path="/Uno" element={<Uno />} />
      <Route   path="/Qwinto" element={<Qwinto />}/>
      <Route   path="/Love" element={<Love />}/>
      <Route   path="/Games" element={<Collection />}/>
    </Routes>
  );
}

export default App;