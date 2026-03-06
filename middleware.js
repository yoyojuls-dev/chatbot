app.use(express.json());
app.use(express.static('public'));

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});