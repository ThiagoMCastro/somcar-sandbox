# ⚡ SomCar Sandbox – Simulador de Elétrica de Som Automotivo

Jogo sandbox no navegador para montar som automotivo com física elétrica realista: bateria/alternador, fusíveis, bitola e material dos cabos, amplificadores, alto-falantes, impedância, ponte, clipping – e tudo pode queimar.

- **Versão 3D (primeira pessoa):** [`jogo3d.html`](jogo3d.html)
- **Versão 2D:** [`index.html`](index.html)

## O que é simulado
- Análise nodal do circuito (série/paralelo/ponte se comportam como na vida real)
- Resistência dos cabos por bitola, material (OFC/CCA), comprimento e temperatura; cabo sobrecarregado esquenta, solta fumaça e derrete
- Fusível com curva tempo × corrente
- Amplificador: REM, subtensão, proteção (curto, impedância baixa, temperatura), ganho × clipping, polaridade invertida
- Alto-falantes: aquecimento da bobina, excursão, tweeter sem capacitor, subwoofer DVC (série/paralelo/fase)
- Terra no chassi (lixado × pintado), multímetro, som real via WebAudio

## Rodar localmente
Basta servir a pasta com qualquer servidor estático (ex.: XAMPP) e abrir `index.html` ou `jogo3d.html`.
