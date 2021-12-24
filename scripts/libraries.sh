REPO_FOLDER=$PWD
ERROR=0

publish() {
  cd $1
  npm publish || ERROR=1
  cd $REPO_FOLDER
}

# Prepare
if [ -d ./node_modules ]; then
  echo Node modules already exists
else
  npm ci
fi

# Publish packages
publish packages/wallet-protocol
publish packages/wallet-protocol-api
publish packages/wallet-protocol-utils
publish packages/base-wallet
publish packages/sw-wallet
publish packages/bok-wallet
exit $ERROR