import React, { useState, useEffect } from 'react';
import { useNavigate } from "react-router-dom";
import './Qwinto.css';
import "./fonts/IMFellDWPica-Italic.ttf";

function Qwinto() {
  const navigate = useNavigate();

  const [dice, setDice] = useState([
    { id: 'QwintoDie1', value: '', clicked: false, color: 'orange' },
    { id: 'QwintoDie2', value: '', clicked: false, color: 'yellow' },
    { id: 'QwintoDie3', value: '', clicked: false, color: 'purple' },
  ]);

  const [diceTotal, setDiceTotal] = useState(0);
  const [minusScore, setMinusScore] = useState(0);
  const [rollButtonText, setRollButtonText] = useState('Roll');
  const [showRollButton, setShowRollButton] = useState(true);
  const [, setPreviousInput] = useState(null); // Track the previously clicked input
  const [lockedInputs, setLockedInputs] = useState([]); // Track locked inputs
  const [rolledOnce, setRolledOnce] = useState(false); // Track if a roll occurred this turn
  const [rerollUsed, setRerollUsed] = useState(false); // Track if reroll used this turn
  const [allowedRowColors, setAllowedRowColors] = useState([]); // Colors allowed this roll
  const [lastAllowedRowColors, setLastAllowedRowColors] = useState([]); // For undo
  const [lastPlacement, setLastPlacement] = useState(null); // { element, rowColor, index }
  const [lastDiceTotal, setLastDiceTotal] = useState(0); // For undo
  const [message, setMessage] = useState('Pick one or more dice, then press Roll.');
  const [messageType, setMessageType] = useState('info'); // 'info' | 'error' | 'success'
  const [showMisthrow, setShowMisthrow] = useState(false);

  const [orangeArray, setOrangeArray] = useState([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const [yellowArray, setYellowArray] = useState([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const [purpleArray, setPurpleArray] = useState([0, 0, 0, 0, 0, 0, 0, 0, 0]);

  useEffect(() => {
    console.log("Updated Dice State:", dice);
  }, [dice]);

  const changePage = (e) => {
    e.preventDefault();
    navigate('/');
  };

  const handleDiceClick = (id) => {
    setDice((prevDice) =>
      prevDice.map((die) =>
        die.id === id ? { ...die, clicked: !die.clicked } : die
      )
    );
  };

  const clearHighlights = () => {
    const allInputs = document.querySelectorAll('.QwintoBoard input');
    allInputs.forEach((input) => {
      input.style.border = '';
      input.style.outline = '';
      input.classList.remove('validTarget');
    });
  };

  const getValidTargets = (total, colors) => {
    const valid = [];
    const allInputs = document.querySelectorAll('.QwintoBoard input');
    allInputs.forEach((input) => {
      const rowClassName = input.parentNode.className;
      const rowColor = rowClassName.includes('orangeRange')
        ? 'orange'
        : rowClassName.includes('yellowRange')
        ? 'yellow'
        : rowClassName.includes('purpleRange')
        ? 'purple'
        : '';

      // Determine index within the parent (column index including spaces)
      const siblings = Array.from(input.parentNode.children);
      const columnIndex = siblings.indexOf(input);

      // Column duplicate check helper
      const columnHasDuplicate = () => {
        const board = input.closest('.QwintoBoard');
        if (!board) return false;
        const rows = [
          board.querySelector('.orangeRange'),
          board.querySelector('.yellowRange'),
          board.querySelector('.purpleRange'),
        ];
        return rows.some((row) => {
          if (!row || row === input.parentNode) return false;
          const cell = row.children[columnIndex];
          if (!cell || cell.classList.contains('QwintoSpaceSquare')) return false;
          const v = parseInt(cell.value, 10);
          return !isNaN(v) && v === total;
        });
      };

      // Determine position index in array (skip space squares)
      let actualIndex = -1;
      for (let i = 0; i < siblings.length; i++) {
        if (!siblings[i].classList.contains('QwintoSpaceSquare')) actualIndex++;
        if (siblings[i] === input) break;
      }

      const currentArray =
        rowColor === 'orange'
          ? orangeArray
          : rowColor === 'yellow'
          ? yellowArray
          : rowColor === 'purple'
          ? purpleArray
          : null;

      const respectsOrder = () => {
        if (!currentArray) return false;
        return currentArray.every((value, idx) => {
          if (value === 0) return true;
          if (idx < actualIndex && value >= total) return false;
          if (idx > actualIndex && value !== 0 && value <= total) return false;
          return true;
        });
      };

      if (colors.includes(rowColor) && input.value === '' && !columnHasDuplicate() && respectsOrder() && currentArray && !currentArray.includes(total)) {
        valid.push(input);
      }
    });
    return valid;
  };

  const highlightValidTargets = (total, colors) => {
    clearHighlights();
    const valid = getValidTargets(total, colors);
    valid.forEach((el) => el.classList.add('validTarget'));
    return valid.length;
  };

  const rollDice = () => {
    console.log("rollDice function called");

    // Check if no dice were clicked
    const anyDiceClicked = dice.some((die) => die.clicked);
    if (!anyDiceClicked) {
      setMessageType('error');
      setMessage('Select at least one die before rolling.');
      return; // Exit the function early if no dice were clicked
    }

    // Prevent more than one reroll per placement
    if (rolledOnce && rerollUsed) {
      setMessageType('error');
      setMessage('Place your number before rolling again.');
      return;
    }

    const updatedDice = dice.map((die) => {
      if (die.clicked) {
        const rolledValue = Math.floor(Math.random() * 6) + 1;
        console.log(`Die ${die.id} rolled value:`, rolledValue);
        return { ...die, value: rolledValue };
      } else {
        console.log(`Die ${die.id} was not clicked, no value assigned`);
      }
      return { ...die, value: "" };
    });

    console.log("Updated Dice after rolling:", updatedDice);

    setDice(updatedDice);

    const total = updatedDice.reduce((sum, die) => {
      const diceValue = parseInt(die.value, 10);
      return die.clicked && !isNaN(diceValue) ? sum + diceValue : sum;
    }, 0);

    console.log("Dice Total Calculated:", total);

    setDiceTotal(total);

    if (!rolledOnce) {
      setRollButtonText("Reroll");
      setRolledOnce(true);
    } else {
      setRerollUsed(true);
    }

    const allowedColors = updatedDice
      .filter((die) => die.clicked && die.value !== "")
      .map((die) => die.color);
    console.log("Allowed Colors:", allowedColors);
    setAllowedRowColors(allowedColors);
    const count = highlightValidTargets(total, allowedColors);

    if (allowedColors.length > 0) {
      const names = allowedColors.map(c => c[0].toUpperCase() + c.slice(1)).join(' / ');
      setMessageType('info');
      setMessage(count > 0 ? `Place ${total} in: ${names}` : `No legal placements in: ${names}. ${!rolledOnce || !rerollUsed ? 'You may reroll.' : 'Mark a misthrow (-5).'}`);
    }

    // Show misthrow button only if no valid targets and reroll already used
    setShowMisthrow(rolledOnce && rerollUsed && count === 0);
  };

  const handleMinusClick = (id) => {
    const element = document.getElementById(id);
    const clicked = element.getAttribute("clicked") === "true";
    element.setAttribute("clicked", !clicked);
    element.style.background = clicked ? "white" : "red";

    if (!clicked) {
      setMinusScore((prevScore) => prevScore + 5);
    } else {
      setMinusScore((prevScore) => prevScore - 5);
    }
  };

  const renderPips = (value) => {
    const pipPositions = [
      [],
      ["one"],
      ["two", "five"],
      ["two", "one", "five"],
      ["two", "three", "four", "five"],
      ["two", "three", "one", "four", "five"],
      ["two", "three", "four", "five", "six", "seven"],
    ];

    return pipPositions[value]
      ? pipPositions[value].map((pip, index) => (
          <div key={index} className={`pip ${pip}`} />
        ))
      : null;
  };

  // eslint-disable-next-line no-unused-vars
  const getRowValues = (rowClassName) => {
    const inputs = document.querySelectorAll(`.${rowClassName} input`);
    return Array.from(inputs)
      .map((input) => parseInt(input.value, 10))
      .filter((val) => !isNaN(val));
  };

  const handleInputClick = (e) => {
    if (lockedInputs.includes(e.target)) {
        return; // Prevent editing of locked inputs
    }

    if (diceTotal <= 0) {
        setMessageType('error');
        setMessage('Roll the dice first.');
        return;
    }

    const rowClassName = e.target.parentNode.className;
    const rowColor = rowClassName.includes("orangeRange")
        ? "orange"
        : rowClassName.includes("yellowRange")
        ? "yellow"
        : rowClassName.includes("purpleRange")
        ? "purple"
        : "";

    const allowedColors = dice
        .filter((die) => die.clicked && die.value !== "")
        .map((die) => die.color);

    if (!allowedColors.includes(rowColor)) {
        setMessageType('error');
        setMessage(`You can only place numbers in: ${allowedColors.join(" / ")}.`);
        return;
    }

    // Calculate the correct index in the array, skipping SpaceSquares
    let actualIndex = -1;
    const inputs = Array.from(e.target.parentNode.children);
    for (let i = 0; i < inputs.length; i++) {
        if (!inputs[i].classList.contains("QwintoSpaceSquare")) {
            actualIndex++;
        }
        if (inputs[i] === e.target) {
            break;
        }
    }

    // Get the array for the current row color
    let currentArray;
    if (rowColor === "orange") {
        currentArray = orangeArray;
    } else if (rowColor === "yellow") {
        currentArray = yellowArray;
    } else if (rowColor === "purple") {
        currentArray = purpleArray;
    }

    // Column duplicate rule: no same number in the same column across rows
    const siblings = Array.from(e.target.parentNode.children);
    const columnIndex = siblings.indexOf(e.target);
    const board = e.target.closest('.QwintoBoard');
    if (board) {
        const rows = [
            board.querySelector('.orangeRange'),
            board.querySelector('.yellowRange'),
            board.querySelector('.purpleRange'),
        ];
        for (const row of rows) {
            if (!row || row === e.target.parentNode) continue;
            const cell = row.children[columnIndex];
            if (!cell || cell.classList.contains('QwintoSpaceSquare')) continue;
            const v = parseInt(cell.value, 10);
            if (!isNaN(v) && v === diceTotal) {
                setMessageType('error');
                setMessage(`That column already has ${diceTotal}. Choose a different spot.`);
                return;
            }
        }
    }

    // Check if the rolled number already exists in the color array
    if (currentArray.includes(diceTotal)) {
        setMessageType('error');
        setMessage(`${diceTotal} already exists in the ${rowColor} row.`);
        return;
    }

    // Validate the number placement according to the rule
    const isValidPlacement = currentArray.every((value, index) => {
        if (value === 0) return true; // Skip 0 values
        if (index < actualIndex && value >= diceTotal) return false; // Check previous numbers
        if (index > actualIndex && value <= diceTotal && value !== 0) return false; // Check next numbers
        return true;
    });

    if (!isValidPlacement) {
        setMessageType('error');
        setMessage(`Invalid. ${diceTotal} must be larger than numbers before and smaller than numbers after.`);
        return;
    }

    if (diceTotal > 0) {
        // Update the corresponding array based on the row color
        if (rowColor === "orange") {
            const newOrangeArray = [...orangeArray];
            newOrangeArray[actualIndex] = diceTotal; // Update only the clicked box
            setOrangeArray(newOrangeArray);
        } else if (rowColor === "yellow") {
            const newYellowArray = [...yellowArray];
            newYellowArray[actualIndex] = diceTotal; // Update only the clicked box
            setYellowArray(newYellowArray);
        } else if (rowColor === "purple") {
            const newPurpleArray = [...purpleArray];
            newPurpleArray[actualIndex] = diceTotal; // Update only the clicked box
            setPurpleArray(newPurpleArray);
        }

        e.target.value = diceTotal; // Insert the diceTotal into the clicked box
        e.target.setAttribute('readOnly', true);
        setLockedInputs((prev) => [...prev, e.target]);
        setPreviousInput(null);

        // Save for undo
        setLastPlacement({ element: e.target, rowColor, index: actualIndex });
        setLastDiceTotal(diceTotal);
        setLastAllowedRowColors(allowedRowColors);

        // Clear turn state: dice selections, totals, highlights, and roll button state
        setDice((prevDice) => prevDice.map((d) => ({ ...d, value: '', clicked: false })));
        setDiceTotal(0);
        setRollButtonText('Roll');
        setShowRollButton(true);
        setRolledOnce(false);
        setRerollUsed(false);
        clearHighlights();
        setAllowedRowColors([]);

        setMessageType('success');
        setMessage(`Placed ${diceTotal}. Pick dice and Roll again.`);
        setShowMisthrow(false);
    }
};

  const undoPlacement = () => {
    if (!lastPlacement) {
      setMessageType('info');
      setMessage('Nothing to undo.');
      return;
    }
    const { element, rowColor, index } = lastPlacement;
    // Clear element
    element.value = '';
    element.removeAttribute('readOnly');
    setLockedInputs((prev) => prev.filter((el) => el !== element));

    // Reset arrays
    if (rowColor === 'orange') {
      const arr = [...orangeArray];
      arr[index] = 0;
      setOrangeArray(arr);
    } else if (rowColor === 'yellow') {
      const arr = [...yellowArray];
      arr[index] = 0;
      setYellowArray(arr);
    } else if (rowColor === 'purple') {
      const arr = [...purpleArray];
      arr[index] = 0;
      setPurpleArray(arr);
    }

    // Restore turn state to placement phase (after reroll)
    setDiceTotal(lastDiceTotal);
    setRolledOnce(true);
    setRerollUsed(true); // prevent more rolls; only place
    setRollButtonText('Reroll');
    setShowRollButton(true);
    setAllowedRowColors(lastAllowedRowColors);
    highlightValidTargets(lastDiceTotal, lastAllowedRowColors);
    setLastPlacement(null);
    setMessageType('info');
    setMessage(`Moved ${lastDiceTotal}. Pick another valid cell.`);
    setShowMisthrow(false);
  };

  const selectedCount = dice.filter((d) => d.clicked).length;
  const rollDisabled = selectedCount === 0 || (rolledOnce && rerollUsed);
  const stepLabel = diceTotal > 0
    ? (rerollUsed ? 'Place' : rolledOnce ? 'Reroll or Place' : 'Roll')
    : 'Roll';

  const handleMisthrow = () => {
    if (!showMisthrow) return;
    setMinusScore((prev) => prev + 5);
    // Reset the turn state as if a placement finished
    setDice((prevDice) => prevDice.map((d) => ({ ...d, value: '', clicked: false })));
    setDiceTotal(0);
    setRollButtonText('Roll');
    setShowRollButton(true);
    setRolledOnce(false);
    setRerollUsed(false);
    clearHighlights();
    setAllowedRowColors([]);
    setShowMisthrow(false);
    setMessageType('info');
    setMessage('Misthrow marked (-5). Pick dice and Roll.');
  };



  const calculateScore = () => {
    const scoreIds = [
      'orangeRowScore',
      'yellowRowScore',
      'purpleRowScore',
      'boxScore1',
      'boxScore2',
      'boxScore3',
      'boxScore4',
      'boxScore5',
    ];
    const total = scoreIds.reduce((sum, id) => {
      const el = document.getElementById(id);
      const v = el ? parseInt(el.value, 10) : NaN;
      return sum + (isNaN(v) ? 0 : v);
    }, 0);
    return total - minusScore;
  };

  const Done = () => {
    const allInputs = document.querySelectorAll(".QwintoBoard input");
  
    const newLockedInputs = Array.from(allInputs).filter((input) => input.value);
    setLockedInputs([...lockedInputs, ...newLockedInputs]); // Lock the inputs with values
  
    newLockedInputs.forEach((input) => {
      input.setAttribute("readOnly", true); // Set inputs with a value to read-only
    });
  
    // Debugging: Check the current values of the arrays
    console.log("Orange Array:", orangeArray);
    console.log("Yellow Array:", yellowArray);
    console.log("Purple Array:", purpleArray);
  
    // Check the specific condition
    //BOX 1
    if (orangeArray[0] !== 0 && yellowArray[1] !== 0 && purpleArray[2] !== 0) {
      console.log("Condition met. Updating boxScore1...");
      const boxScore1Input = document.getElementById("boxScore1");
      if (boxScore1Input) {
        boxScore1Input.value = purpleArray[2];
      } else {
        console.log("Element with id 'boxScore1' not found.");
      }
    } else {
      console.log("Condition not met.");
    }
    //BOX 2
    if (orangeArray[1] !== 0 && yellowArray[2] !== 0 && purpleArray[3] !== 0) {
      console.log("Condition met. Updating boxScore2...");
      const boxScore2Input = document.getElementById("boxScore2");
      if (boxScore2Input) {
        boxScore2Input.value = orangeArray[1];
      } else {
        console.log("Element with id 'boxScore2' not found.");
      }
    } else {
      console.log("Condition not met.");
    }
    //BOX 3
    if (orangeArray[4] !== 0 && yellowArray[5] !== 0 && purpleArray[6] !== 0) {
      const boxScore3Input = document.getElementById("boxScore3");
      if (boxScore3Input) {
        boxScore3Input.value = orangeArray[4];
      } else {
        console.log("Element with id 'boxScore3' not found.");
      }
    } else {
      console.log("Condition not met.");
    }
    if (orangeArray[5] !== 0 && yellowArray[6] !== 0 && purpleArray[7] !== 0) {
      const boxScore4Input = document.getElementById("boxScore4");
      if (boxScore4Input) {
        boxScore4Input.value = yellowArray[6];
      } else {
        console.log("Element with id 'boxScore4' not found.");
      }
    } else {
      console.log("Condition not met.");
    }
    if (orangeArray[6] !== 0 && yellowArray[7] !== 0 && purpleArray[8] !== 0) {
      console.log("Condition met. Updating boxScore5...");
      const boxScore5Input = document.getElementById("boxScore5");
      if (boxScore5Input) {
        boxScore5Input.value = purpleArray[8];
      } else {
        console.log("Element with id 'boxScore5' not found.");
      }
    } else {
      console.log("Condition not met.");
    }
  
    if (orangeArray.every((value) => value !== 0)) {
      const orangeScoreInput = document.getElementById("orangeRowScore");
      if (orangeScoreInput) {
        orangeScoreInput.value = orangeArray[orangeArray.length - 1];
      }
    }
    if (yellowArray.every((value) => value !== 0)) {
      const yellowScoreInput = document.getElementById("yellowRowScore");
      if (yellowScoreInput) {
        yellowScoreInput.value = yellowArray[yellowArray.length - 1];
      }
    }
    if (purpleArray.every((value) => value !== 0)) {
      const purpleScoreInput = document.getElementById("purpleRowScore");
      if (purpleScoreInput) {
        purpleScoreInput.value = purpleArray[purpleArray.length - 1];
      }
    }

    const finalScore = calculateScore();
    alert(`Your final score is: ${finalScore}`);
  
    // Reset game state
    setDice([
      { id: "QwintoDie1", value: "", clicked: false, color: "orange" },
      { id: "QwintoDie2", value: "", clicked: false, color: "yellow" },
      { id: "QwintoDie3", value: "", clicked: false, color: "purple" },
    ]);
    setDiceTotal(0);
    setRollButtonText("Roll");
    setShowRollButton(true);
    setPreviousInput(null);
    console.log("Game reset.");
    console.log(orangeArray)
    console.log(yellowArray)
    console.log(purpleArray)
  };
  
  


  return (
    <div className="pageQwinto">
      <div className="bg"></div>
      <div className="bg bg2"></div>
      <div className="bg bg3"></div>
      <nav className="navBar">
        <div className="buttonContainer">
          <button className="button" id="homeButton" onClick={changePage}>
            HOME
          </button>
        </div>
      </nav>
      <div className="hud">
        <div className={`toast ${messageType}`}>{message}</div>
        <div className="status">
          <div className="statusItem"><span className="label">Step:</span> {stepLabel}</div>
          <div className="statusItem"><span className="label">Total:</span> {diceTotal || '-'}</div>
          <div className="statusItem"><span className="label">Allowed:</span> {allowedRowColors.length ? allowedRowColors.map(c => (
            <span key={c} className={`tag ${c}`}>{c}</span>
          )) : <span className="muted">—</span>}</div>
        </div>
      </div>
      <div className="Board">
        <header className="Board-header">
          <img className="boredBackground" src="" alt="" />
        </header>
        <div className="header"></div>
        <div className="QwintoBoard" id="Qwintoboard1">
          <div className="orangeRange">
            <input readOnly className="QwintoSpaceSquare"></input>
            <input readOnly className="QwintoSpaceSquare"></input>
            <input
              className="QwintoCircleSquare"
              id="orangeScore"
              maxLength="2"
              onClick={handleInputClick}
              readOnly
            ></input>
            <input
              className="QwintoHexSquare"
              id="orangeScore"
              maxLength="2"
              onClick={handleInputClick}
              readOnly
            ></input>
            <input
              className="QwintoCircleSquare"
              id="orangeScore"
              maxLength="2"
              onClick={handleInputClick}
              readOnly
            ></input>
            <input readOnly className="QwintoSpaceSquare"></input>
            <input
              className="QwintoCircleSquare"
              id="orangeScore"
              maxLength="2"
              onClick={handleInputClick}
              readOnly
            ></input>
            <input
              className="QwintoHexSquare"
              id="orangeScore"
              maxLength="2"
              onClick={handleInputClick}
              readOnly
            ></input>
            <input
              className="QwintoCircleSquare"
              id="orangeScore"
              maxLength="2"
              onClick={handleInputClick}
              readOnly
            ></input>
            <input
              className="QwintoCircleSquare"
              id="orangeScore"
              maxLength="2"
              onClick={handleInputClick}
              readOnly
            ></input>
            <input
              className="QwintoCircleSquare"
              id="orangeScore"
              maxLength="2"
              onClick={handleInputClick}
              readOnly
            ></input>
            <input
              className="QwintoCircleSquare"
              id="orangeScore"
              maxLength="2"
              onClick={handleInputClick}
              readOnly
            ></input>
          </div>
          <div className="yellowRange">
            <input readOnly className="QwintoSpaceSquare"></input>
            <input
              className="QwintoCircleSquare"
              id="yellowScore"
              maxLength="2"
              onClick={handleInputClick}
              readOnly
            ></input>
            <input
              className="QwintoCircleSquare"
              id="yellowScore"
              maxLength="2"
              onClick={handleInputClick}
              readOnly
            ></input>
            <input
              className="QwintoCircleSquare"
              id="yellowScore"
              maxLength="2"
              onClick={handleInputClick}
              readOnly
            ></input>
            <input
              className="QwintoCircleSquare"
              id="yellowScore"
              maxLength="2"
              onClick={handleInputClick}
              readOnly
            ></input>
            <input
              className="QwintoCircleSquare"
              id="yellowScore"
              maxLength="2"
              onClick={handleInputClick}
              readOnly
            ></input>
            <input readOnly className="QwintoSpaceSquare"></input>
            <input
              className="QwintoCircleSquare"
              id="yellowScore"
              maxLength="2"
              onClick={handleInputClick}
              readOnly
            ></input>
            <input
              className="QwintoHexSquare"
              id="yellowScore"
              maxLength="2"
              onClick={handleInputClick}
              readOnly
            ></input>
            <input
              className="QwintoCircleSquare"
              id="yellowScore"
              maxLength="2"
              onClick={handleInputClick}
              readOnly
            ></input>
            <input
              className="QwintoCircleSquare"
              id="yellowScore"
              maxLength="2"
              onClick={handleInputClick}
              readOnly
            ></input>
          </div>
          <div className="purpleRange">
            <input
              className="QwintoCircleSquare"
              id="purpleScore"
              maxLength="2"
              onClick={handleInputClick}
              readOnly
            ></input>
            <input
              className="QwintoCircleSquare"
              id="purpleScore"
              maxLength="2"
              onClick={handleInputClick}
              readOnly
            ></input>
            <input
              className="QwintoHexSquare"
              id="purpleScore"
              maxLength="2"
              onClick={handleInputClick}
              readOnly
            ></input>
            <input
              className="QwintoCircleSquare"
              id="purpleScore"
              maxLength="2"
              onClick={handleInputClick}
              readOnly
            ></input>
            <input readOnly className="QwintoSpaceSquare"></input>
            <input
              className="QwintoCircleSquare"
              id="purpleScore"
              maxLength="2"
              onClick={handleInputClick}
              readOnly
            ></input>
            <input
              className="QwintoCircleSquare"
              id="purpleScore"
              maxLength="2"
              onClick={handleInputClick}
              readOnly
            ></input>
            <input
              className="QwintoCircleSquare"
              id="purpleScore"
              maxLength="2"
              onClick={handleInputClick}
              readOnly
            ></input>
            <input
              className="QwintoCircleSquare"
              id="purpleScore"
              maxLength="2"
              onClick={handleInputClick}
              readOnly
            ></input>
            <input
              className="QwintoHexSquare"
              id="purpleScore"
              maxLength="2"
              onClick={handleInputClick}
              readOnly
            ></input>
            <input readOnly className="QwintoSpaceSquare"></input>
            <input readOnly className="QwintoSpaceSquare"></input>
          </div>
          <div className="minus">
            {Array.from({ length: 4 }, (_, i) => (
              <input
                key={i}
                onClick={() => handleMinusClick(`minus${i + 1}`)}
                id={`minus${i + 1}`}
                clicked="false"
                value={"-5"}
                readOnly
              />
            ))}
          </div>
          <div className="QwintoScore">
            <input
              className="QwintoCircleSquare"
              id="orangeRowScore"
              maxLength="2"
              onClick={handleInputClick}
              readOnly
            ></input>
            <input
              className="QwintoCircleSquare"
              id="yellowRowScore"
              maxLength="2"
              onClick={handleInputClick}
              readOnly
            ></input>
            <input
              className="QwintoCircleSquare"
              id="purpleRowScore"
              maxLength="2"
              onClick={handleInputClick}
              readOnly
            ></input>
            <input
              readOnly
              className="QwintoSpaceSquare"
              id="equationSign"
              value={"+"}
            ></input>
            <input
              readOnly
              className="QwintoHexSquare"
              id="boxScore1"
              maxLength="2"
              onClick={handleInputClick}
            ></input>
            <input
              readOnly
              className="QwintoHexSquare"
              id="boxScore2"
              maxLength="2"
              onClick={handleInputClick}
            ></input>
            <input
              readOnly
              className="QwintoHexSquare"
              id="boxScore3"
              maxLength="2"
              onClick={handleInputClick}
            ></input>
            <input
              readOnly
              className="QwintoHexSquare"
              id="boxScore4"
              maxLength="2"
              onClick={handleInputClick}
            ></input>
            <input
              readOnly
              className="QwintoHexSquare"
              id="boxScore5"
              maxLength="2"
              onClick={handleInputClick}
            ></input>
            <input
              readOnly
              className="QwintoSpaceSquare"
              id="equationSign"
              value={"-"}
            ></input>
            <input
              readOnly
              className="QwintoHexSquare"
              id="minusScore"
              value={minusScore}
              maxLength="2"
              onClick={handleInputClick}
            ></input>
            <input
              readOnly
              className="QwintoSpaceSquare"
              id="equationSign"
              value={"="}
            ></input>
            <input
              readOnly
              className="QwintoHexSquare"
              maxLength="2"
              onClick={handleInputClick}
            ></input>
          </div>
          <div className="QwintoDice">
            {dice.map((die) => (
              <div
                key={die.id}
                className={`die ${die.id}`}
                id={die.id}
                onClick={() => handleDiceClick(die.id)}
                style={{ borderColor: die.clicked ? 'red' : 'black' }}
              >
                {renderPips(die.value)}
              </div>
            ))}
            <input
              readOnly
              className="QwintoDieTotal"
              value={diceTotal}
            />
            {showRollButton && (
              <button onClick={rollDice} className="rollButton" disabled={rollDisabled}>
                {rollButtonText}
              </button>
            )}
            {showMisthrow && (
              <button onClick={handleMisthrow} className="rollButton">
                Misthrow -5
              </button>
            )}
            <button onClick={undoPlacement} className="rollButton">
              Undo
            </button>
            <button onClick={Done} className="rollButton">
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Qwinto;
