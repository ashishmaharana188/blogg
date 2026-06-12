import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message: "backend Alive",
  });
});

app.post("/blogSaveRequest", (req, res) => {
  const savedBlog = req.body;

  console.log(req.body);

  res.json({
    success: true,
    message: "Blog saved",
    blog: savedBlog,
  });
});

app.listen(3000, () => {
  console.log("Server running");
});
