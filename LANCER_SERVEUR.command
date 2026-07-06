#!/bin/bash
cd "$(dirname "$0")"

echo "╔════════════════════════════════════════════╗"
echo "║   AB2S Sécurité — Base de données Clients   ║"
echo "╚════════════════════════════════════════════╝"
echo ""

# Installation si besoin
if [ ! -d "node_modules" ]; then
  echo "📦 Première utilisation : installation des modules..."
  npm install
  echo ""
fi

echo "🚀 Démarrage du serveur..."
echo ""
node server.js
