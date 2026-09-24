import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {TimeNavigator} from '../components/time-navigator';
import {TimeMatrix} from '../components/time-matrix';
import {defaultTimeWindow} from '../lib/time-window';
import '../app/time/time.css';
function Fixture(){const [value,setValue]=useState(defaultTimeWindow('2026-09-24'));return <main className="time-app" style={{height:'100vh',boxSizing:'border-box'}}><output id="value">{JSON.stringify(value)}</output><div style={{display:'flex',flexDirection:'column',width:'66%',flex:1,minHeight:0}}><TimeMatrix rows={[]} plans={[]} categories={[]} first={value.start} count={value.days} now={Date.parse('2026-09-24T12:00:00+08:00')} selected="2026-09-24" onSelect={()=>{}}/><TimeNavigator value={value} domain={{start:'2024-01-01',end:'2026-12-31'}} onChange={setValue}/></div></main>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
