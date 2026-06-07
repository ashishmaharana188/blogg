import React from "react";
import { useState } from "react";
import { userForm } from "./pageTypes";

const UserForm = ({ textSaved }: userForm) => {
  const [userFormState, setUserFormState] = useState();

  const handleFormChange = () => {
    const userData = (e: any) => {
      let userForm = e.target.value;
      console.log(userData);
    };
    const textSaved = setUserFormState(userFormState);
  };

  return (
    <div>
      <div>
        <h1>User Form</h1>
      </div>
      <div>
        <input type="text" onChange={handleFormChange}></input>
      </div>
    </div>
  );
};

export default UserForm;
